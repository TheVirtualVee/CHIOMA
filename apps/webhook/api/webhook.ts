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
  const workerId = `worker_${process.env.VERCEL_REGION || "local"}`;
  const trace = createTraceContext(workerId);
  
  // GET: WhatsApp webhook verification challenge
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

  // Extract message ID early for telemetry if possible
  const entry = req.body?.entry?.[0];
  const value = entry?.changes?.[0]?.value;
  const messages = value?.messages;
  const messageId = messages?.[0]?.id || "unknown";

  const telemetry = new TelemetryManager(messageId, trace.traceId);
  telemetry.record("REQUEST_RECEIVED", { method: req.method, traceId: trace.traceId, executionId: trace.executionId });

  try {
    const config = validateConfig();

    const signature = req.headers["x-hub-signature-256"] as string;
    
    // 🧠 CRITICAL: Reconstructing JSON from an object is non-deterministic (whitespace/ordering).
    // We MUST use the raw body if available to match Meta's signature.
    const rawBody = (req as any).rawBody 
      ? (req as any).rawBody.toString() 
      : (typeof req.body === "string" ? req.body : JSON.stringify(req.body));

    if (!config.WHATSAPP_APP_SECRET) {
      telemetry.record("MISSING_WHATSAPP_APP_SECRET");
      throw new Error("WHATSAPP_APP_SECRET is not configured. Cannot validate signature.");
    }

    if (!validateSignature(rawBody, signature, config.WHATSAPP_APP_SECRET)) {
      console.warn(`[WEBHOOK] INVALID_SIGNATURE: traceId=${trace.traceId} sig=${signature}`);
      telemetry.record("INVALID_SIGNATURE", { 
        providedSignature: signature,
        bodyPreview: rawBody.slice(0, 100)
      });
      return res.status(401).json({ error: "Invalid signature" });
    }

    if (!messages || messages.length === 0) {
      telemetry.record("NO_MESSAGES_IGNORED");
      return res.status(200).json({ ok: true, ignored: true });
    }

    const message = messages[0];
    const from = message.from as string;
    const text = (message.text?.body as string) || "";

    const tenantId = `tenant_${value.metadata?.phone_number_id || "default"}`;
    const correlationId = `corr_${messageId}`;

    const sql = createDatabaseClient(config.DATABASE_URL, { max: 5 });

    try {
      telemetry.record("LEDGER_CHECK_STARTED");
      console.log(`[DEBUG] [${trace.traceId}] Checking idempotency ledger...`);
      // ── Idempotency gate ───────────────────────────────────────────────
      const [existing] = await sql`
        SELECT status, updated_at FROM message_ledger WHERE message_id = ${messageId}
      `;

      if (existing) {
        console.log(`[DEBUG] [${trace.traceId}] Existing ledger record found: ${existing.status}`);
        if (existing.status === "COMPLETED") {
          telemetry.record("LEDGER_BLOCK", { reason: "COMPLETED" });
          await sql.end();
          return res.status(200).json({ ok: true, duplicate: true });
        }
        const lastUpdate = new Date(existing.updated_at).getTime();
        if (existing.status === "PROCESSING" && Date.now() - lastUpdate < 30000) {
          telemetry.record("LEDGER_BLOCK", { reason: "IN_PROGRESS" });
          await sql.end();
          return res.status(200).json({ ok: true, retry_ignored: true });
        }
        await sql`
          UPDATE message_ledger SET status = 'PROCESSING', updated_at = NOW()
          WHERE message_id = ${messageId}
        `;
      } else {
        console.log(`[DEBUG] [${trace.traceId}] Creating new ledger record...`);
        await sql`
          INSERT INTO message_ledger (message_id, tenant_id, status)
          VALUES (${messageId}, ${tenantId}, 'RECEIVED')
        `;
      }
      telemetry.record("LEDGER_WRITTEN", { status: existing ? "UPDATED" : "INSERTED" });

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
        traceContext: trace,
      };

      console.log(`[DEBUG] [${trace.traceId}] Starting AtomicRunner...`);
      telemetry.record("ATOMIC_RUNNER_STARTING");
      const result = await runAtomicStaffLoop(staffLoopInput, sql, {
        apiKey: config.LLM_API_KEY,
        provider: config.LLM_PROVIDER,
      }, telemetry);
      console.log(`[DEBUG] [${trace.traceId}] AtomicRunner finished with response: ${result.responseText?.slice(0, 20)}...`);
      telemetry.record("ATOMIC_RUNNER_FINISHED", { resultType: result.responseType });
      
      // ── Deliver response via WhatsApp ──────────────────────────────────
      if (result.responseText) {
        const phoneNumberId = value.metadata?.phone_number_id as string | undefined;
        if (phoneNumberId) {
          console.log(`[DEBUG] [${trace.traceId}] Dispatching to WhatsApp: ${phoneNumberId}`);
          telemetry.record("WHATSAPP_DISPATCH_STARTING", { 
            decisionId: result.decision?.decision_hash 
          });
          try {
            await sendWhatsAppMessage(phoneNumberId, config.WHATSAPP_ACCESS_TOKEN, from, result.responseText, trace);
            console.log(`[DEBUG] [${trace.traceId}] WhatsApp dispatch success!`);
            telemetry.record("WHATSAPP_DISPATCH_SUCCESS");
          } catch (waErr: unknown) {
            const msg = waErr instanceof Error ? waErr.message : String(waErr);
            console.error(`[DEBUG] [${trace.traceId}] WhatsApp dispatch failed: ${msg}`);
            telemetry.record("WHATSAPP_DISPATCH_FAILED", { error: msg });
          }
        } else {
          console.warn(`[DEBUG] [${trace.traceId}] Skipping dispatch: No phoneNumberId found in metadata`);
          telemetry.record("WHATSAPP_DISPATCH_SKIPPED", { reason: "MISSING_PHONE_NUMBER_ID" });
        }
      } else {
        console.warn(`[DEBUG] [${trace.traceId}] No responseText to send.`);
      }

      telemetry.complete("COMPLETED");
      console.log(`[WEBHOOK] HANDLER_COMPLETING [${trace.traceId}]`);
      return res.status(200).json({ ok: true });

    } catch (innerErr: unknown) {
      const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
      telemetry.record("EXECUTION_FAILED", { error: msg });
      telemetry.complete("FAILED");
      return res.status(200).json({ ok: false, stage: "processing", error: msg });
    } finally {
      await sql.end();
    }

  } catch (outerErr: unknown) {
    const msg = outerErr instanceof Error ? outerErr.message : String(outerErr);
    telemetry.record("INGRESS_FAILED", { error: msg });
    telemetry.complete("FAILED");
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
