import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { validateConfig } from "../../../infrastructure/config/index.js";
import { createDatabaseClient, commitEvent } from "../../../infrastructure/database/index.js";
import { runStaffLoop } from "../../../core/staff-loop/index.js";

/**
 * api/webhook.ts
 *
 * CHIOMA WhatsApp Webhook Handler.
 * FINAL WIRING FIX — Ensuring single entrypoint and direct async execution.
 */

export default async function handler(req: any, res: any) {
  console.log("[WEBHOOK] REQUEST_RECEIVED");

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
    
    // Validate signature
    const signature = req.headers["x-hub-signature-256"];
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (!validateSignature(rawBody, signature, config.WHATSAPP_APP_SECRET || "")) {
      console.log("[WEBHOOK] INVALID_SIGNATURE");
      return res.status(401).json({ error: "Invalid signature" });
    }

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

    console.log("[WEBHOOK] PROCESSING_MESSAGE", { from, text });

    const tenantId = `tenant_${value.metadata?.phone_number_id || "default"}`;
    const correlationId = `corr_${messageId}`;

    const sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });

    try {
      // 1. Idempotency Check
      const [existing] = await sql`SELECT message_id FROM processed_messages WHERE message_id = ${messageId}`;
      if (existing) {
        console.log("[WEBHOOK] DUPLICATE_SKIP", { messageId });
        return res.status(200).json({ ok: true, duplicate: true });
      }

      // 2. Commit Ingress Event
      const eventId = randomUUID();
      await sql.begin(async (tx: any) => {
        await tx`INSERT INTO processed_messages (message_id, tenant_id) VALUES (${messageId}, ${tenantId})`;
        await commitEvent(tx, {
          id: eventId,
          type: "MESSAGE_RECEIVED",
          payload: { channel: "whatsapp", from, text, waMessageId: messageId },
          tenantId,
          correlationId,
          causationId: correlationId
        });
      });

      console.log("[WEBHOOK] CALLING_RUNSTAFFLOOP");
      
      // 3. EXECUTE STAFF LOOP
      const result = await runStaffLoop(
        { tenantId, senderPhone: from, messageText: text, correlationId, causationId: eventId, eventId, channel: "whatsapp" },
        sql,
        { apiKey: config.LLM_API_KEY, provider: config.LLM_PROVIDER }
      );

      console.log("[WEBHOOK] STAFF_LOOP_DONE", { responseType: result.responseType });

      // 4. SEND REPLY
      if (result.responseText) {
        const { sendWhatsAppMessage } = await import("../../../infrastructure/whatsapp/index.js");
        const phoneNumberId = value.metadata?.phone_number_id;
        
        if (phoneNumberId) {
          console.log("[WEBHOOK] SENDING_WHATSAPP_REPLY", { to: from });
          await sendWhatsAppMessage(phoneNumberId, config.WHATSAPP_ACCESS_TOKEN, from, result.responseText);
          console.log("[WEBHOOK] REPLY_SENT_SUCCESS");
        } else {
          console.log("[WEBHOOK] MISSING_PHONE_NUMBER_ID");
        }
      }

      console.log("[WEBHOOK] FLOW_COMPLETED");
      return res.status(200).json({ ok: true });

    } catch (err) {
      console.error("[WEBHOOK] INNER_ERROR", err);
      return res.status(200).json({ ok: false, error: String(err) });
    } finally {
      await sql.end();
    }

  } catch (err) {
    console.error("[WEBHOOK] OUTER_ERROR", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

function validateSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const received = signature.slice(7);
  return expected.length === received.length && timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}
