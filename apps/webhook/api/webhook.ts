import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { validateConfig } from "../../../infrastructure/config/index.js";
import { createDatabaseClient, commitEvent } from "../../../infrastructure/database/index.js";
import { runStaffLoop } from "../../../core/staff-loop/index.js";

/**
 * api/webhook.ts
 *
 * CHIOMA WhatsApp Webhook Handler.
 */

export default async function handler(req: any, res: any) {
  const start = Date.now();
  
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

    if (mode === "subscribe" && token === verifyToken) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  let config;
  try {
    config = validateConfig();
  } catch (err) {
    return res.status(500).send("Configuration incomplete");
  }

  if (req.method === "POST") {
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const signature = req.headers["x-hub-signature-256"];

    if (!validateSignature(rawBody, signature, config.WHATSAPP_APP_SECRET || "")) {
      return res.status(401).send("Unauthorized");
    }

    const body = req.body;
    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) return res.status(200).send("OK");

    const messageId = message.id;
    const tenantId = `tenant_${body.entry[0].changes[0].value.metadata?.phone_number_id || 'default'}`;
    const correlationId = `corr_${messageId}`;

    const sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });

    try {
      const [existing] = await sql`SELECT message_id FROM processed_messages WHERE message_id = ${messageId}`;
      if (existing) return res.status(200).send("OK");

      const eventId = randomUUID();
      await sql.begin(async (tx: any) => {
        await tx`INSERT INTO processed_messages (message_id, tenant_id) VALUES (${messageId}, ${tenantId})`;
        await commitEvent(tx, {
          id: eventId,
          type: "MESSAGE_RECEIVED",
          payload: { channel: "whatsapp", from: message.from, text: message.text?.body || "", waMessageId: messageId },
          tenantId,
          correlationId,
          causationId: correlationId // For the first event, correlation is causation
        });
      });

      const result = await runStaffLoop(
        { 
          tenantId, 
          senderPhone: message.from, 
          messageText: message.text?.body || "", 
          correlationId, 
          causationId: eventId, 
          eventId, 
          channel: "whatsapp" 
        },
        sql,
        { apiKey: config.LLM_API_KEY, provider: config.LLM_PROVIDER }
      );


      if (result.responseText) {
        const { sendWhatsAppMessage } = await import("../../../infrastructure/whatsapp/index.js");
        const phoneNumberId = body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
        
        if (phoneNumberId) {
          await sendWhatsAppMessage(
            phoneNumberId,
            config.WHATSAPP_ACCESS_TOKEN,
            message.from,
            result.responseText
          );
        }
      }

      console.log("STAFF_LOOP_COMPLETE", { messageId, tenantId, latency: Date.now() - start });
      return res.status(200).send("OK");

    } catch (err) {
      console.error("WEBHOOK_PROCESSING_FAILURE", { messageId, error: String(err) });
      return res.status(200).send("OK");
    } finally {
      await sql.end();
    }
  }

  return res.status(405).send("Method Not Allowed");
}

function validateSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const received = signature.slice(7);
  return expected.length === received.length && timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}

