import { createHmac, timingSafeEqual } from "node:crypto";
import postgres from "postgres";

/**
 * api/webhook.ts — Institutional Ingress Boundary
 * Implements: Signature Validation, Idempotency, Dead-Letter Logging, and Structured Observation.
 */

const logger = {
  info: (msg: string, ctx?: any) => console.log(JSON.stringify({ severity: "INFO", message: msg, ...ctx, ts: new Date().toISOString() })),
  warn: (msg: string, ctx?: any) => console.log(JSON.stringify({ severity: "WARN", message: msg, ...ctx, ts: new Date().toISOString() })),
  error: (msg: string, ctx?: any) => console.log(JSON.stringify({ severity: "ERROR", message: msg, ...ctx, ts: new Date().toISOString() })),
};

export default async function handler(req: any, res: any) {
  const start = Date.now();
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
  const APP_SECRET = process.env.WHATSAPP_APP_SECRET;
  const DATABASE_URL = process.env.DATABASE_URL;

  try {
    // 1. GET Handshake (Verification)
    if (req.method === "GET") {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];

      if (mode === "subscribe" && token === VERIFY_TOKEN) {
        logger.info("WEBHOOK_VERIFIED", { mode });
        return res.status(200).send(challenge);
      }
      return res.status(403).send("Forbidden");
    }

    // 2. POST Event Ingestion
    if (req.method === "POST") {
      if (!APP_SECRET || !DATABASE_URL) {
        logger.error("INGRESS_BOOT_FAILURE", { reason: "Missing config" });
        return res.status(500).send("Configuration error");
      }

      const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      const signature = req.headers["x-hub-signature-256"];

      // A. Signature Validation
      if (!validateSignature(rawBody, signature, APP_SECRET)) {
        logger.warn("INVALID_SIGNATURE", { signature: signature?.slice(0, 16) });
        return res.status(401).send("Unauthorized");
      }

      const body = req.body;
      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];

      if (!message) {
        return res.status(200).send("OK"); // Meta status update or non-message event
      }

      const messageId = message.id;
      const tenantId = `tenant_${value.metadata?.phone_number_id || 'default'}`;
      const correlationId = `corr_${messageId}`;

      const sql = postgres(DATABASE_URL, { max: 1, ssl: "require" });

      try {
        // B. Idempotency Check (Institutional Guard)
        const [existing] = await sql`SELECT message_id FROM processed_messages WHERE message_id = ${messageId}`;
        if (existing) {
          logger.info("DUPLICATE_MESSAGE_REJECTED", { messageId, tenantId, correlationId });
          return res.status(200).send("OK");
        }

        // C. Authoritative Event Commit
        const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const eventType = "MESSAGE_RECEIVED";
        const payload = {
          channel: "whatsapp",
          from: message.from,
          text: message.text?.body || "",
          waMessageId: messageId,
          raw: body
        };

        await sql.begin(async (tx) => {
          // Record processed message for idempotency
          await tx`INSERT INTO processed_messages (message_id, tenant_id) VALUES (${messageId}, ${tenantId})`;
          
          // Commit domain event
          await tx`
            INSERT INTO core.events (id, type, payload, tenant_id, correlation_id, version)
            VALUES (${eventId}, ${eventType}, ${tx.json(payload)}, ${tenantId}, ${correlationId}, '1.1')
          `;
        });

        const latency = Date.now() - start;
        logger.info("EVENT_INGESTED", { 
          messageId, 
          tenantId, 
          correlationId, 
          eventId, 
          latency,
          sender: message.from 
        });

        return res.status(200).send("OK");

      } catch (err: any) {
        // D. Dead-Letter Strategy (Ingress Fallback)
        logger.error("INGESTION_FAILURE", { messageId, tenantId, error: String(err) });
        
        await sql`
          INSERT INTO failed_events (tenant_id, raw_payload, headers, error)
          VALUES (${tenantId || 'unknown'}, ${sql.json(body)}, ${sql.json(req.headers)}, ${String(err)})
        `;
        
        return res.status(200).send("OK"); // Always ack Meta to prevent aggressive retries if we logged it
      } finally {
        await sql.end();
      }
    }

    return res.status(405).send("Method Not Allowed");

  } catch (err: any) {
    logger.error("INGRESS_CRASH", { error: String(err) });
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

function validateSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const received = signature.slice(7);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}
