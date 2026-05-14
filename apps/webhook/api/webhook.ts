import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { validateConfig } from "../../../infrastructure/config/index.js";
import { createDatabaseClient } from "../../../infrastructure/database/index.js";
import { runAtomicStaffLoop } from "../../../core/staff-loop/atomic-runner.js";
import { sendWhatsAppMessage } from "../../../infrastructure/whatsapp/index.js";

/**
 * api/webhook.ts — WhatsApp Cloud API inbound handler.
 *
 * All imports are STATIC. Dynamic imports were causing silent failures in
 * Vercel's esbuild bundler — modules not resolved at bundle time failed
 * silently at runtime after LEDGER_LOCKED with no logged error.
 */

export default async function handler(req: any, res: any) {
  const start = Date.now();
  const l = (m: string) => console.log(`[WEBHOOK] [${Date.now() - start}ms] ${m}`);

  l("REQUEST_RECEIVED");

  // GET: WhatsApp webhook verification challenge
  if (req.method === "GET") {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === verifyToken) {
      l("VERIFICATION_CHALLENGE_OK");
      return res.status(200).send(req.query["hub.challenge"]);
    }
    l("VERIFICATION_CHALLENGE_REJECTED");
    return res.status(403).send("Forbidden");
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    l("VALIDATING_CONFIG_START");
    const config = validateConfig();
    l("CONFIG_VALIDATED");

    const signature = req.headers["x-hub-signature-256"] as string;
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);

    const hasSignature = !!signature;
    const hasSecret = !!config.WHATSAPP_APP_SECRET;
    l(`SIGNATURE_CHECK: has_sig=${hasSignature} has_secret=${hasSecret}`);

    if (!validateSignature(rawBody, signature, config.WHATSAPP_APP_SECRET || "")) {
      l("INVALID_SIGNATURE");
      return res.status(401).json({ error: "Invalid signature" });
    }
    l("SIGNATURE_VALID");

    const entry = req.body?.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) {
      l("NO_MESSAGES: ignored");
      return res.status(200).json({ ok: true, ignored: true });
    }

    const message = messages[0];
    const from = message.from as string;
    const text = (message.text?.body as string) || "";
    const messageId = message.id as string;

    l(`IDEMPOTENCY_INIT: ${messageId}`);

    const tenantId = `tenant_${value.metadata?.phone_number_id || "default"}`;
    const correlationId = `corr_${messageId}`;

    const sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });

    try {
      // ── Idempotency gate ───────────────────────────────────────────────
      const [existing] = await sql`
        SELECT status, updated_at FROM message_ledger WHERE message_id = ${messageId}
      `;

      if (existing) {
        if (existing.status === "COMPLETED") {
          l("LEDGER_BLOCK: COMPLETED");
          return res.status(200).json({ ok: true, duplicate: true });
        }
        const lastUpdate = new Date(existing.updated_at).getTime();
        if (existing.status === "PROCESSING" && Date.now() - lastUpdate < 30000) {
          l("LEDGER_BLOCK: IN_PROGRESS");
          return res.status(200).json({ ok: true, retry_ignored: true });
        }
        await sql`
          UPDATE message_ledger SET status = 'PROCESSING', updated_at = NOW()
          WHERE message_id = ${messageId}
        `;
      } else {
        await sql`
          INSERT INTO message_ledger (message_id, tenant_id, status)
          VALUES (${messageId}, ${tenantId}, 'RECEIVED')
        `;
      }
      l("LEDGER_LOCKED");

      // ── Execute staff loop ─────────────────────────────────────────────
      const eventId = randomUUID();
      const staffLoopInput = {
        messageId,
        tenantId,
        senderPhone: from,
        messageText: text,
        correlationId,
        causationId: eventId,
        eventId,
        channel: "whatsapp" as const,
      };

      l("INVOKING_ATOMIC_STAFF_LOOP");
      const result = await runAtomicStaffLoop(staffLoopInput, sql, {
        apiKey: config.LLM_API_KEY,
        provider: config.LLM_PROVIDER,
      });
      l(`STAFF_LOOP_DONE: type=${result.responseType} latency=${result.latencyMs}ms`);

      // ── Deliver response via WhatsApp ──────────────────────────────────
      if (result.responseText) {
        const phoneNumberId = value.metadata?.phone_number_id as string | undefined;
        if (phoneNumberId) {
          l("WHATSAPP_DISPATCH_START");
          try {
            await sendWhatsAppMessage(phoneNumberId, config.WHATSAPP_ACCESS_TOKEN, from, result.responseText);
            l("WHATSAPP_DISPATCH_SUCCESS");
          } catch (waErr: unknown) {
            const msg = waErr instanceof Error ? waErr.message : String(waErr);
            console.error(`[WEBHOOK] WHATSAPP_DISPATCH_FAILED: ${msg}`);
          }
        } else {
          l("WHATSAPP_DISPATCH_SKIPPED: no phone_number_id");
        }
      }

      l("LIFECYCLE_COMPLETE");
      return res.status(200).json({ ok: true });

    } catch (innerErr: unknown) {
      const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
      const stack = innerErr instanceof Error ? innerErr.stack : undefined;
      console.error(`[WEBHOOK] INNER_SHELL_FAILURE: ${msg}`);
      if (stack) console.error(`[WEBHOOK] STACK: ${stack}`);
      return res.status(200).json({ ok: false, stage: "processing", error: msg });
    } finally {
      await sql.end();
    }

  } catch (outerErr: unknown) {
    const msg = outerErr instanceof Error ? outerErr.message : String(outerErr);
    console.error(`[WEBHOOK] OUTER_SHELL_FAILURE: ${msg}`);
    return res.status(200).json({ ok: false, stage: "ingress", error: msg });
  }
}

function validateSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const received = signature.slice(7);
  return expected.length === received.length &&
    timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}
