import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { validateConfig } from "../../../infrastructure/config/index.js";
import { createDatabaseClient, commitEvent } from "../../../infrastructure/database/index.js";
import { runStaffLoop } from "../../../core/staff-loop/index.js";

/**
 * api/webhook.ts
 *
 * CHIOMA WhatsApp Webhook Handler.
 * EXECUTION GUARANTEE LAYER (No-500 Policy).
 */

export default async function handler(req: any, res: any) {
  const start = Date.now();
  const l = (m: string) => console.error(`[WEBHOOK] [${Date.now() - start}ms] ${m}`);

  l("REQUEST_RECEIVED");

  // 1. Handshake (GET)
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
    
    // 2. Validate Signature
    const signature = req.headers["x-hub-signature-256"] as string;
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    
    if (!validateSignature(rawBody, signature, config.WHATSAPP_APP_SECRET || "")) {
      l("INVALID_SIGNATURE");
      return res.status(401).json({ error: "Invalid signature" });
    }

    // 3. Extract Meta Payload
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

    l("PROCESSING_MESSAGE: " + from);

    const tenantId = `tenant_${value.metadata?.phone_number_id || "default"}`;
    const correlationId = `corr_${messageId}`;

    const sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });

    try {
      // 4. Idempotency Check
      const [existing] = await sql`SELECT message_id FROM processed_messages WHERE message_id = ${messageId}`;
      if (existing) {
        l("DUPLICATE_SKIP");
        return res.status(200).json({ ok: true, duplicate: true });
      }

      const eventId = randomUUID();
      
      // 5. Commit Ingress Event
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

      l("INVOKING_STAFF_LOOP");
      
      // 6. Execute Staff Loop (Guaranteed Return)
      const result = await runStaffLoop(
        { 
          tenantId, 
          senderPhone: from, 
          messageText: text, 
          correlationId, 
          causationId: eventId, 
          eventId, 
          channel: "whatsapp" 
        },
        sql,
        { apiKey: config.LLM_API_KEY, provider: config.LLM_PROVIDER }
      );

      l("STAFF_LOOP_COMPLETE: " + result.responseType);

      // 7. Dispatch Outbound Message
      if (result.responseText) {
        const { sendWhatsAppMessage } = await import("../../../infrastructure/whatsapp/index.js");
        const phoneNumberId = value.metadata?.phone_number_id;
        
        if (phoneNumberId) {
          l("DISPATCHING_WHATSAPP_REPLY");
          await sendWhatsAppMessage(phoneNumberId, config.WHATSAPP_ACCESS_TOKEN, from, result.responseText);
          l("DISPATCH_SUCCESS");
        }
      }

      l("FLOW_COMPLETED_SUCCESSFULLY");
      return res.status(200).json({ ok: true });

    } catch (innerErr) {
      l("INNER_FAILURE: " + String(innerErr));
      // Even if DB or Dispatch fails, we return 200 to acknowledge Meta
      return res.status(200).json({ ok: false, error: "Internal processing error" });
    } finally {
      await sql.end();
    }

  } catch (outerErr) {
    l("OUTER_FAILURE: " + String(outerErr));
    // NO 500 POLICY: Always return 200 with an error flag
    return res.status(200).json({ ok: false, error: "Configuration or Ingress failure" });
  }
}

function validateSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const received = signature.slice(7);
  return expected.length === received.length && timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}
