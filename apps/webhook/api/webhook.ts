import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { validateConfig } from "../../../infrastructure/config/index.js";
import { createDatabaseClient } from "../../../infrastructure/database/index.js";
import { runAtomicStaffLoop } from "../../../core/staff-loop/atomic-runner.js";
import { sendWhatsAppMessage } from "../../../infrastructure/whatsapp/index.js";
import { TelemetryManager, createTraceContext } from "../../../core/telemetry/index.js";

/**
 * api/webhook.ts — WhatsApp Cloud API inbound handler.
 */

export default async function handler(req: any, res: any) {
  console.log(`[BOOT] Webhook Handler Active [v1.4-universal-guard] [${req.method}]`);
  
  try {
    const workerId = `worker_${(typeof process !== 'undefined' ? process.env?.VERCEL_REGION : 'unknown') || "local"}`;
    const trace = createTraceContext(workerId);
    
    // 1. GET: WhatsApp webhook verification challenge
    if (req.method === "GET") {
      const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
      if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === verifyToken) {
        return res.status(200).send(req.query["hub.challenge"]);
      }
      return res.status(403).send("Forbidden");
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // 2. Ingress Telemetry & Identification
    const entry = req.body?.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    const messages = value?.messages;
    const messageId = messages?.[0]?.id || "unknown";

    const telemetry = new TelemetryManager(messageId, trace.traceId);
    telemetry.record("REQUEST_RECEIVED", { 
      method: req.method, 
      traceId: trace.traceId, 
      executionId: trace.executionId 
    });

    const config = validateConfig();

    // 3. Signature Validation
    const signature = req.headers["x-hub-signature-256"] as string;
    const rawBody = (req as any).rawBody 
      ? (req as any).rawBody.toString() 
      : (typeof req.body === "string" ? req.body : JSON.stringify(req.body));

    if (!config.WHATSAPP_APP_SECRET) {
      telemetry.record("MISSING_WHATSAPP_APP_SECRET");
      throw new Error("WHATSAPP_APP_SECRET is not configured.");
    }

    if (!validateSignature(rawBody, signature, config.WHATSAPP_APP_SECRET)) {
      console.warn(`[WEBHOOK] INVALID_SIGNATURE [${trace.traceId}]`);
      telemetry.record("INVALID_SIGNATURE");
      return res.status(401).json({ error: "Invalid signature" });
    }

    // 4. Message Filtering
    if (!messages || messages.length === 0) {
      telemetry.record("NO_MESSAGES_IGNORED");
      telemetry.complete("COMPLETED");
      return res.status(200).json({ ok: true, ignored: true });
    }

    const message = messages[0];
    const from = message.from as string;
    const text = (message.text?.body as string) || "";
    const tenantId = `tenant_${value.metadata?.phone_number_id || "default"}`;
    const correlationId = `corr_${messageId}`;

    // 5. Database & Atomic Runner Execution
    const sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });

    try {
      // 🧠 GLOBAL TIMEOUT GUARD: Ensure we don't let the process hang indefinitely
      const lifecyclePromise = (async () => {
        // ── Idempotency Check ─────────────────────────────────────────────
        telemetry.record("LEDGER_CHECK_STARTED");
        const [existing] = await sql`
          SELECT status, updated_at FROM message_ledger WHERE message_id = ${messageId}
        `;

        if (existing) {
          if (existing.status === "COMPLETED") {
            telemetry.record("LEDGER_BLOCK", { reason: "COMPLETED" });
            telemetry.complete("COMPLETED");
            return { duplicate: true };
          }
          const lastUpdate = new Date(existing.updated_at).getTime();
          if (existing.status === "PROCESSING" && Date.now() - lastUpdate < 25000) {
            telemetry.record("LEDGER_BLOCK", { reason: "IN_PROGRESS" });
            telemetry.complete("COMPLETED");
            return { retry_ignored: true };
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

        // ── Run Atomic Staff Loop ────────────────────────────────────────
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
          traceContext: trace,
        };

        telemetry.record("ATOMIC_RUNNER_STARTING");
        const result = await runAtomicStaffLoop(staffLoopInput, sql, {
          apiKey: config.LLM_API_KEY,
          provider: config.LLM_PROVIDER,
        }, telemetry);
        
        telemetry.record("ATOMIC_RUNNER_FINISHED", { resultType: result.responseType });

        // ── Dispatch Response ────────────────────────────────────────────
        if (result.responseText) {
          const phoneNumberId = (value.metadata?.phone_number_id as string | undefined)
            ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
          if (phoneNumberId) {
            telemetry.record("WHATSAPP_DISPATCH_STARTING");
            try {
              await sendWhatsAppMessage(phoneNumberId, config.WHATSAPP_ACCESS_TOKEN, from, result.responseText, trace);
              telemetry.record("WHATSAPP_DISPATCH_SUCCESS");
            } catch (waErr: unknown) {
              const msg = waErr instanceof Error ? waErr.message : String(waErr);
              telemetry.record("WHATSAPP_DISPATCH_FAILED", { error: msg });
            }
          }
        }

        telemetry.complete("COMPLETED");
        return { ok: true };
      })();

      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("LIFECYCLE_TIMEOUT")), 15000)
      );

      const lifecycleResult = await Promise.race([lifecyclePromise, timeoutPromise]) as any;

      if (lifecycleResult.duplicate) {
        return res.status(200).json({ ok: true, duplicate: true });
      }
      if (lifecycleResult.retry_ignored) {
        return res.status(200).json({ ok: true, retry_ignored: true });
      }
      if (lifecycleResult.ignored) {
        return res.status(200).json({ ok: true, ignored: true });
      }

      return res.status(200).json({ ok: true, traceId: trace.traceId });

    } catch (innerErr: unknown) {
      const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
      telemetry.record("EXECUTION_FAILED", { error: msg });
      telemetry.complete("FAILED");
      return res.status(200).json({ ok: false, error: msg });
    } finally {
      await sql.end();
    }

  } catch (outerErr: unknown) {
    const msg = outerErr instanceof Error ? outerErr.message : String(outerErr);
    console.error(`[FATAL_INBOUND_CRASH]`, outerErr);
    return res.status(500).json({ ok: false, error: "Universal Guard Triggered", detail: msg });
  }
}

function validateSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const received = signature.slice(7);
  return expected.length === received.length &&
    timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}
