import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { validateConfig } from "../../../infrastructure/config/index.js";
import { createDatabaseClient, commitEvent } from "../../../infrastructure/database/index.js";
import { runStaffLoop } from "../../../core/staff-loop/index.js";

/**
 * api/webhook.ts
 *
 * CHIOMA WhatsApp Webhook Handler.
 * RETURN TRACE MODE — tracking exact exit points.
 */

export default async function handler(req: any, res: any) {
  console.log("[FLOW] ENTER");

  const exit = (reason: string, status = 200) => {
    console.log("[FLOW] EARLY_EXIT", reason);
    return res.status(status).json({ ok: false, reason });
  };

  try {
    if (req.method === "GET") {
      console.log("[FLOW] GET_REQUEST_DETECTED");
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];
      const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

      if (mode === "subscribe" && token === verifyToken) {
        console.log("[FLOW] CHALLENGE_SUCCESS");
        return res.status(200).send(challenge);
      }
      return exit("VERIFY_TOKEN_MISMATCH", 403);
    }

    if (req.method !== "POST") {
      return exit("METHOD_NOT_ALLOWED_" + req.method, 405);
    }

    console.log("[FLOW] POST_REQUEST_ACCEPTED");

    let config;
    try {
      config = validateConfig();
    } catch (err) {
      console.error("[WEBHOOK] CONFIG_MISSING", String(err));
      return exit("CONFIG_INCOMPLETE", 500);
    }

    console.log("[FLOW] CONFIG_VALID");

    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const signature = req.headers["x-hub-signature-256"];

    if (!validateSignature(rawBody, signature, config.WHATSAPP_APP_SECRET || "")) {
      return exit("INVALID_SIGNATURE", 401);
    }

    console.log("[FLOW] SIGNATURE_OK");

    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) {
      console.log("[FLOW] NO_MESSAGES_IN_PAYLOAD", JSON.stringify(value));
      return exit("NON_MESSAGE_EVENT");
    }

    const message = messages[0];
    const from = message.from;
    const text = message.text?.body || "";
    const messageId = message.id;

    console.log("[FLOW] MESSAGE_RECEIVED", { from, text, messageId });

    const tenantId = `tenant_${value.metadata?.phone_number_id || 'default'}`;
    const correlationId = `corr_${messageId}`;
    const sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });

    try {
      const [existing] = await sql`SELECT message_id FROM processed_messages WHERE message_id = ${messageId}`;
      if (existing) {
        return exit("DUPLICATE_MESSAGE_IGNORED");
      }

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

      console.log("[FLOW] STARTING_STAFF_LOOP");

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

      if (result.responseText) {
        console.log("[FLOW] SENDING_REPLY");
        const { sendWhatsAppMessage } = await import("../../../infrastructure/whatsapp/index.js");
        const phoneNumberId = value.metadata?.phone_number_id;
        
        if (phoneNumberId) {
          await sendWhatsAppMessage(
            phoneNumberId,
            config.WHATSAPP_ACCESS_TOKEN,
            from,
            result.responseText
          );
        }
      }

      console.log("[FLOW] SUCCESS_END");
      return res.status(200).json({ ok: true });

    } catch (err) {
      console.error("[FLOW] PROCESSING_CRASH", err);
      return exit("INTERNAL_PROCESSING_ERROR");
    } finally {
      await sql.end();
    }

  } catch (fatalError) {
    console.error("[FLOW] FATAL_ERROR", fatalError);
    return res.status(500).json({
      ok: false,
      error: String(fatalError)
    });
  }
}

function validateSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const received = signature.slice(7);
  return expected.length === received.length && timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}
