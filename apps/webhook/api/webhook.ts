import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { validateConfig } from "../../../infrastructure/config/index.js";
import { createDatabaseClient, commitEvent } from "../../../infrastructure/database/index.js";
import { runStaffLoop } from "../../../core/staff-loop/index.js";

/**
 * api/webhook.ts
 *
 * CHIOMA WhatsApp Webhook Handler.
 * DIAGNOSTIC BUILD — single-log + response-body trace.
 */

export default async function handler(req: any, res: any) {
  // Collect ALL trace data into one object, emit as ONE log, return in body
  const trace: string[] = [];
  const t = (msg: string) => { trace.push(msg); };

  t("ENTER");
  t("METHOD:" + req.method);
  t("PATH:" + req.url);
  t("CWD:" + process.cwd());

  try {
    t("BODY_TYPE:" + typeof req.body);
    t("BODY_TRUTHY:" + !!req.body);
    if (req.body) {
      t("BODY_KEYS:" + Object.keys(req.body).join(","));
    }
  } catch (e) { t("BODY_ACCESS_ERROR:" + e); }

  // ── GET: Webhook verification ─────────────────────────────────────────
  if (req.method === "GET") {
    t("GET_BRANCH");
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

    if (mode === "subscribe" && token === verifyToken) {
      t("CHALLENGE_OK");
      console.log("[WEBHOOK_TRACE]", trace.join(" | "));
      return res.status(200).send(challenge);
    }
    t("CHALLENGE_FAIL");
    console.log("[WEBHOOK_TRACE]", trace.join(" | "));
    return res.status(403).send("Forbidden");
  }

  // ── POST: Message processing ──────────────────────────────────────────
  if (req.method !== "POST") {
    t("NOT_POST_EXIT");
    console.log("[WEBHOOK_TRACE]", trace.join(" | "));
    return res.status(405).json({ trace });
  }

  t("POST_ACCEPTED");

  // Config
  let config: any;
  try {
    config = validateConfig();
    t("CONFIG_OK");
  } catch (err) {
    t("CONFIG_FAIL:" + err);
    console.log("[WEBHOOK_TRACE]", trace.join(" | "));
    return res.status(500).json({ trace });
  }

  t("TOKEN_PRESENT:" + !!config.WHATSAPP_ACCESS_TOKEN);
  t("SECRET_PRESENT:" + !!config.WHATSAPP_APP_SECRET);

  // Signature
  try {
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    t("RAW_BODY_LEN:" + rawBody.length);
    const signature = req.headers["x-hub-signature-256"];
    t("SIG_PRESENT:" + !!signature);

    const sigValid = validateSignature(rawBody, signature, config.WHATSAPP_APP_SECRET || "");
    t("SIG_VALID:" + sigValid);

    if (!sigValid) {
      t("EXIT:INVALID_SIGNATURE");
      console.log("[WEBHOOK_TRACE]", trace.join(" | "));
      return res.status(401).json({ trace });
    }
  } catch (e) {
    t("SIG_CRASH:" + e);
    console.log("[WEBHOOK_TRACE]", trace.join(" | "));
    return res.status(500).json({ trace });
  }

  // Payload extraction
  const entry = req.body?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const messages = value?.messages;

  t("HAS_ENTRY:" + !!entry);
  t("HAS_CHANGE:" + !!change);
  t("FIELD:" + change?.field);
  t("HAS_MESSAGES:" + !!messages);
  t("HAS_STATUSES:" + !!value?.statuses);

  if (!messages || messages.length === 0) {
    t("EXIT:NON_MESSAGE_EVENT");
    console.log("[WEBHOOK_TRACE]", trace.join(" | "));
    return res.status(200).json({ ok: true, ignored: true, trace });
  }

  const message = messages[0];
  const from = message.from;
  const text = message.text?.body || "";
  const messageId = message.id;

  t("MSG_FROM:" + from);
  t("MSG_TEXT:" + text);
  t("MSG_ID:" + messageId);

  const tenantId = `tenant_${value.metadata?.phone_number_id || "default"}`;
  const correlationId = `corr_${messageId}`;

  // DB + Staff Loop
  const sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });
  try {
    const [existing] = await sql`SELECT message_id FROM processed_messages WHERE message_id = ${messageId}`;
    if (existing) {
      t("EXIT:DUPLICATE_MSG");
      console.log("[WEBHOOK_TRACE]", trace.join(" | "));
      return res.status(200).json({ ok: true, duplicate: true, trace });
    }

    t("INSERTING_EVENT");
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

    t("RUNNING_STAFF_LOOP");
    const result = await runStaffLoop(
      { tenantId, senderPhone: from, messageText: text, correlationId, causationId: eventId, eventId, channel: "whatsapp" },
      sql,
      { apiKey: config.LLM_API_KEY, provider: config.LLM_PROVIDER }
    );
    t("STAFF_LOOP_DONE:" + result.responseType);

    if (result.responseText) {
      t("SENDING_REPLY");
      const { sendWhatsAppMessage } = await import("../../../infrastructure/whatsapp/index.js");
      const phoneNumberId = value.metadata?.phone_number_id;
      t("PHONE_NUMBER_ID:" + phoneNumberId);

      if (phoneNumberId) {
        await sendWhatsAppMessage(phoneNumberId, config.WHATSAPP_ACCESS_TOKEN, from, result.responseText);
        t("REPLY_SENT");
      } else {
        t("NO_PHONE_NUMBER_ID");
      }
    }

    t("SUCCESS_END");
    console.log("[WEBHOOK_TRACE]", trace.join(" | "));
    return res.status(200).json({ ok: true, trace });

  } catch (err) {
    t("PROCESSING_CRASH:" + err);
    console.log("[WEBHOOK_TRACE]", trace.join(" | "));
    return res.status(200).json({ ok: false, trace });
  } finally {
    await sql.end();
  }
}

function validateSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const received = signature.slice(7);
  return expected.length === received.length && timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}
