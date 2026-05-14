import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { validateConfig } from "../../../infrastructure/config/index.js";
import { createDatabaseClient, commitEvent } from "../../../infrastructure/database/index.js";
import { validateStaffAction, sanitizeStaffReply } from "../../../core/staff-rules/index.js";
import { generateStaffReply } from "../../../services/response-service/index.js";
import { executeStaffDecision } from "../../../services/employment-logic/index.js";

// --- INLINED ONBOARDING SERVICE ---
const ONBOARDING_STEPS = [
  { key: "business_name", question: "Hello! I'm CHIOMA. What is the name of your business?" },
  { key: "social_learning", question: "Nice! Please send me links to your Instagram, TikTok, or Website so I can learn about your products, tone, and pricing." },
  { key: "validate_draft", question: "Does this look correct to you? Please tell me what I should fix or add!" },
  { key: "escalation_contact", question: "Almost done. If a customer has an urgent request, what phone number should I notify?" }
];

async function inlinedOnboarding(sql: any, tenantId: string, messageText: string) {
  console.error("[INLINED_ONBOARDING] START");
  const [profile] = await sql`SELECT onboarding_status, current_onboarding_step FROM employer_profiles WHERE tenant_id = ${tenantId}`;
  if (profile?.onboarding_status === 'COMPLETED') return { completed: true };
  if (!profile) {
    await sql`INSERT INTO employer_profiles (tenant_id, onboarding_status, current_onboarding_step) VALUES (${tenantId}, 'STARTED', ${ONBOARDING_STEPS[0].key})`;
    return { completed: false, response: ONBOARDING_STEPS[0].question };
  }
  // Simplified for tracing
  return { completed: false, response: "Onboarding in progress..." };
}

/**
 * api/webhook.ts
 *
 * CHIOMA WhatsApp Webhook Handler.
 * NUCLEAR OPTION BUILD — Inlined logic to bypass workspace import issues.
 */

export default async function handler(req: any, res: any) {
  console.error("[WEBHOOK] NUCLEAR_REQUEST_RECEIVED");

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
    const signature = req.headers["x-hub-signature-256"];
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);

    if (!validateSignature(rawBody, signature, config.WHATSAPP_APP_SECRET || "")) {
      console.error("[WEBHOOK] INVALID_SIGNATURE");
      return res.status(401).json({ error: "Invalid signature" });
    }

    const entry = req.body?.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) return res.status(200).json({ ok: true });

    const message = messages[0];
    const from = message.from;
    const text = message.text?.body || "";
    const messageId = message.id;

    console.error("[WEBHOOK] PROCESSING_MESSAGE", { from, text });

    const tenantId = `tenant_${value.metadata?.phone_number_id || "default"}`;
    const correlationId = `corr_${messageId}`;

    const sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });

    try {
      const [existing] = await sql`SELECT message_id FROM processed_messages WHERE message_id = ${messageId}`;
      if (existing) return res.status(200).json({ ok: true, duplicate: true });

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

      console.error("[WEBHOOK] CALLING_INLINED_LOOP");
      
      // --- INLINED STAFF LOOP ---
      const onboarding = await inlinedOnboarding(sql, tenantId, text);
      let responseText = onboarding.response;

      if (onboarding.completed) {
        console.error("[WEBHOOK] ONBOARDING_COMPLETE_CALLING_LLM");
        const [profile] = await sql`SELECT business_name FROM employer_profiles WHERE tenant_id = ${tenantId}`;
        const proposed = await generateStaffReply(text, "Inlined Brief", profile || { business_name: "The Shop" });
        responseText = proposed.response;
      }

      if (responseText) {
        const { sendWhatsAppMessage } = await import("../../../infrastructure/whatsapp/index.js");
        const phoneNumberId = value.metadata?.phone_number_id;
        if (phoneNumberId) {
          console.error("[WEBHOOK] ATTEMPTING_SEND");
          await sendWhatsAppMessage(phoneNumberId, config.WHATSAPP_ACCESS_TOKEN, from, responseText);
          console.error("[WEBHOOK] SEND_SUCCESS");
        }
      }

      return res.status(200).json({ ok: true });

    } catch (err) {
      console.error("[WEBHOOK] LOOP_CRASH", err);
      throw err;
    } finally {
      await sql.end();
    }

  } catch (err) {
    console.error("[WEBHOOK] OUTER_CRASH", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

function validateSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const received = signature.slice(7);
  return expected.length === received.length && timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}
