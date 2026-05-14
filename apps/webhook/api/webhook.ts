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
  console.log("[FLOW] 1 - HANDLER_ENTER");
  console.log("[FLOW] 2 - METHOD_CHECK", req.method);

  if (req.method === "GET") {
    console.log("[FLOW] EARLY_RETURN", "GET_VERIFY_BRANCH");
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

    if (mode === "subscribe" && token === verifyToken) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  console.log("[FLOW] 3 - METHOD_ACCEPTED - not GET");

  let config;
  try {
    config = validateConfig();
    console.log("[FLOW] 4 - CONFIG_VALIDATED");
  } catch (err) {
    console.error("[WEBHOOK] CONFIG_FAILURE", String(err));
    console.log("[FLOW] EARLY_RETURN", "CONFIG_FAILURE");
    return res.status(500).send("Configuration incomplete");
  }

  console.log("[FLOW] 5 - VERIFY_BRANCH_CHECK - method is:", req.method);

  if (req.method === "POST") {
    console.log("[FLOW] 6 - POST_PROCESSING_START");

    // TOP-LEVEL fatal catch — nothing escapes silently
    try {
      console.log("[WEBHOOK] REQUEST_RECEIVED");
      console.log("[WEBHOOK] BODY_TYPE", typeof req.body);
      console.log("[WEBHOOK] BODY_KEYS", req.body ? Object.keys(req.body) : []);
      console.log("[CONFIG] TOKEN_PRESENT", !!process.env.WHATSAPP_ACCESS_TOKEN);

      // ── SAFE INTROSPECTION ─────────────────────────────────────────────
      try {
        const entry = req.body?.entry?.[0];
        const change = entry?.changes?.[0];
        const value = change?.value;

        console.log("[WEBHOOK] STRUCTURE_CHECK", {
          hasEntry: !!entry,
          hasChange: !!change,
          hasValue: !!value,
          hasMessages: !!value?.messages,
          hasStatuses: !!value?.statuses,
          field: change?.field
        });

        if (value?.messages) {
          console.log("[WEBHOOK] MESSAGE_COUNT", value.messages.length);
          const first = value.messages[0];
          console.log("[WEBHOOK] FIRST_MESSAGE", {
            from: first?.from,
            type: first?.type,
            id: first?.id
          });
        } else {
          console.log("[WEBHOOK] NO_MESSAGES_PRESENT");
        }
      } catch (introspectError) {
        console.error("[WEBHOOK_INTROSPECTION_FATAL]", introspectError);
      }
      // ── END SAFE INTROSPECTION ─────────────────────────────────────────

      // Signature validation — rawBody must be derived safely
      console.log("[FLOW] 7 - PAYLOAD_EXTRACTION - building rawBody");
      const rawBody = typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body);
      const signature = req.headers["x-hub-signature-256"];
      console.log("[FLOW] 7a - SIGNATURE_HEADER_PRESENT", !!signature);
      console.log("[FLOW] 7b - APP_SECRET_PRESENT", !!config.WHATSAPP_APP_SECRET);

      if (!validateSignature(rawBody, signature, config.WHATSAPP_APP_SECRET || "")) {
        console.error("[WEBHOOK] SIGNATURE_INVALID");
        console.log("[FLOW] EARLY_RETURN", "SIGNATURE_INVALID_401");
        return res.status(401).send("Unauthorized");
      }
      console.log("[WEBHOOK] SIGNATURE_VALID");

      const body = req.body;
      const entry = body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const messages = value?.messages;

      if (!messages || messages.length === 0) {
        console.log("[WEBHOOK] NON_MESSAGE_EVENT — field:", change?.field);
        console.log("[FLOW] EARLY_RETURN", "NON_MESSAGE_EVENT_200");
        return res.status(200).json({ ok: true, ignored: true });
      }

      const message = messages[0];
      const from = message.from;
      const text = message.text?.body || "";
      const messageId = message.id;

      console.log("[WEBHOOK] MESSAGE_EXTRACTED", { from, text, messageId });
      console.log("[FLOW] 8 - STAFF_LOOP_START");

      const tenantId = `tenant_${value.metadata?.phone_number_id || "default"}`;
      const correlationId = `corr_${messageId}`;
      const sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });

      try {
        const [existing] = await sql`SELECT message_id FROM processed_messages WHERE message_id = ${messageId}`;
        if (existing) {
          console.log("[WEBHOOK] DUPLICATE_MESSAGE_IGNORED", messageId);
          console.log("[FLOW] EARLY_RETURN", "DUPLICATE_MESSAGE_200");
          return res.status(200).send("OK");
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

        const result = await runStaffLoop(
          { tenantId, senderPhone: from, messageText: text, correlationId, causationId: eventId, eventId, channel: "whatsapp" },
          sql,
          { apiKey: config.LLM_API_KEY, provider: config.LLM_PROVIDER }
        );

        if (result.responseText) {
          console.log("[FLOW] 9 - WHATSAPP_SEND");
          const { sendWhatsAppMessage } = await import("../../../infrastructure/whatsapp/index.js");
          const phoneNumberId = value.metadata?.phone_number_id;
          if (phoneNumberId) {
            await sendWhatsAppMessage(phoneNumberId, config.WHATSAPP_ACCESS_TOKEN, from, result.responseText);
          } else {
            console.error("[WEBHOOK] MISSING_PHONE_NUMBER_ID");
          }
        }

        console.log("[FLOW] 10 - RESPONSE_SUCCESS");
        console.log("[WEBHOOK] STAFF_LOOP_COMPLETE", { messageId, tenantId, latency: Date.now() - start });
        return res.status(200).send("OK");

      } catch (processingErr) {
        console.error("[WEBHOOK_PROCESSING_FAILURE]", String(processingErr));
        console.log("[FLOW] EARLY_RETURN", "PROCESSING_ERROR_200");
        return res.status(200).send("OK");
      } finally {
        await sql.end();
      }

    } catch (fatalError) {
      console.error("[WEBHOOK_FATAL]", fatalError);
      console.log("[FLOW] EARLY_RETURN", "FATAL_500");
      return res.status(500).json({ ok: false, error: String(fatalError) });
    }
  }

  console.log("[FLOW] EARLY_RETURN", "METHOD_NOT_ALLOWED_405", req.method);
  return res.status(405).send("Method Not Allowed");
}

function validateSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const received = signature.slice(7);
  return expected.length === received.length && timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}
