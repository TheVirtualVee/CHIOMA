import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { validateConfig } from "../../../infrastructure/config/index.js";
import { createDatabaseClient, commitEvent } from "../../../infrastructure/database/index.js";
import { runStaffLoop } from "../../../core/staff-loop/index.js";

/**
 * api/webhook.ts
 *
 * CHIOMA WhatsApp Webhook Handler.
 * IDEMPOTENCY & ERROR DECODER BUILD (v1.3).
 */

export default async function handler(req: any, res: any) {
  const start = Date.now();
  const l = (m: string) => console.error(`[WEBHOOK] [${Date.now() - start}ms] ${m}`);

  l("REQUEST_RECEIVED");

  if (req.method === "GET") {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === verifyToken) {
      return res.status(200).send(req.query["hub.challenge"]);
    }
    return res.status(403).send("Forbidden");
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const config = validateConfig();
    
    // 1. Validate Signature
    const signature = req.headers["x-hub-signature-256"] as string;
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    
    if (!validateSignature(rawBody, signature, config.WHATSAPP_APP_SECRET || "")) {
      l("INVALID_SIGNATURE");
      return res.status(401).json({ error: "Invalid signature" });
    }

    // 2. Extract Meta Payload
    const entry = req.body?.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const message = messages[0];
    const from = message.from;
    const text = message.text?.body || "";
    const messageId = message.id;

    l("IDEMPOTENCY_INIT: " + messageId);

    const tenantId = `tenant_${value.metadata?.phone_number_id || "default"}`;
    const correlationId = `corr_${messageId}`;

    const sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });

    try {
      // 3. HARD IDEMPOTENCY: Try insert first. Catch unique violation.
      try {
        await sql`INSERT INTO processed_messages (message_id, tenant_id) VALUES (${messageId}, ${tenantId})`;
        l("IDEMPOTENCY_LOCKED");
      } catch (dbErr: any) {
        if (dbErr.code === '23505') { // Postgres Unique Violation
          l("DUPLICATE_EXIT_TRIGGERED");
          return res.status(200).json({ ok: true, duplicate: true });
        }
        throw dbErr;
      }

      const eventId = randomUUID();
      
      // 4. Commit Ingress Event
      await commitEvent(sql, {
        id: eventId,
        type: "MESSAGE_RECEIVED",
        payload: { channel: "whatsapp", from, text, waMessageId: messageId },
        tenantId,
        correlationId,
        causationId: correlationId
      });

      l("INVOKING_STAFF_LOOP");
      
      const result = await runStaffLoop(
        { tenantId, senderPhone: from, messageText: text, correlationId, causationId: eventId, eventId, channel: "whatsapp" },
        sql,
        { apiKey: config.LLM_API_KEY, provider: config.LLM_PROVIDER }
      );

      // 5. Dispatch with Error Decoding
      if (result.responseText) {
        const { sendWhatsAppMessage } = await import("../../../infrastructure/whatsapp/index.js");
        const phoneNumberId = value.metadata?.phone_number_id;
        
        if (phoneNumberId) {
          l("WHATSAPP_DISPATCH_START");
          try {
            await sendWhatsAppMessage(phoneNumberId, config.WHATSAPP_ACCESS_TOKEN, from, result.responseText);
            l("WHATSAPP_DISPATCH_SUCCESS");
          } catch (waErr: any) {
            l("WHATSAPP_DISPATCH_FAILED: " + waErr.message);
            // We still return 200 to Meta so they stop retrying a broken message
          }
        }
      }

      return res.status(200).json({ ok: true });

    } catch (innerErr) {
      l("INNER_SHELL_FAILURE: " + String(innerErr));
      return res.status(200).json({ ok: false, error: "Internal processing failure" });
    } finally {
      await sql.end();
    }

  } catch (outerErr) {
    l("OUTER_SHELL_FAILURE: " + String(outerErr));
    return res.status(200).json({ ok: false, error: "Ingress failure" });
  }
}

function validateSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const received = signature.slice(7);
  return expected.length === received.length && timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}
