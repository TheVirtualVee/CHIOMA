import { createHmac, timingSafeEqual } from "node:crypto";
import { validateConfig } from "../../../infrastructure/config/index.js";
import { createDatabaseClient } from "../../../infrastructure/database/index.js";
import { sendWhatsAppMessage } from "../../../infrastructure/whatsapp/index.js";
import { TelemetryManager, createTraceContext } from "../../../core/telemetry/index.js";
import { resolveInstance } from "../../../core/routing/instance-router.js";
import { notifyFounder, isFounderNumber } from "../../../core/founder/control-plane.js";
import { processFounderCommand } from "../../../core/founder/command-engine.js";
import { ExecutionKernel } from "../../../core/kernel/execution-kernel.js";
import { DeliveryGuaranteeLayer } from "../../../core/delivery/index.js";

export default async function handler(req: any, res: any) {
  try {
    const workerId = `worker_${(typeof process !== 'undefined' ? process.env?.VERCEL_REGION : 'unknown') || "local"}`;
    const trace = createTraceContext(workerId);
    
    if (req.method === "GET") {
      const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
      if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === verifyToken) {
        return res.status(200).send(req.query["hub.challenge"]);
      }
      return res.status(403).send("Forbidden");
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const entry = req.body?.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    const messages = value?.messages;
    if (!messages || messages.length === 0) return res.status(200).json({ ok: true, ignored: true });

    const message = messages[0];
    const messageId = message.id || "unknown";
    const from = message.from as string;
    const text = (message.text?.body as string) || "";
    const phoneNumberId = value.metadata?.phone_number_id as string;
    
    const telemetry = new TelemetryManager(messageId, trace.traceId);
    const config = validateConfig();

    const signature = req.headers["x-hub-signature-256"] as string;
    const rawBody = (req as any).rawBody 
      ? (req as any).rawBody.toString() 
      : (typeof req.body === "string" ? req.body : JSON.stringify(req.body));

    if (!validateSignature(rawBody, signature, config.WHATSAPP_APP_SECRET || "")) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    const sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });
    try {
      if (isFounderNumber(from)) {
        telemetry.record("FOUNDER_COMMAND_RECEIVED", { from });
        const replyText = await processFounderCommand(text, sql);
        await sendWhatsAppMessage(
          phoneNumberId,
          config.WHATSAPP_ACCESS_TOKEN,
          from,
          replyText,
          trace
        );
        telemetry.complete("FOUNDER_COMMAND_DISPATCHED");
        return res.status(200).json({ ok: true, plane: "FOUNDER_CONTROL" });
      }
      const instance = await resolveInstance(sql, phoneNumberId);
      if (!instance) {
        telemetry.record("INSTANCE_NOT_FOUND", { phoneNumberId });
        await notifyFounder(
          {
            type: "ONBOARDING_REQUEST",
            summary: `Unregistered number messaged CHIOMA: ${from}`,
            detail: { phoneNumberId, messageText: text.slice(0, 80) }
          },
          phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
          config.WHATSAPP_ACCESS_TOKEN
        );
        return res.status(200).json({ ok: false, error: "Instance not registered" });
      }

      telemetry.setTenant(instance.tenant_id);
      telemetry.setInstance(instance.instance_id);

      const staffLoopInput = {
        messageId,
        tenantId: instance.tenant_id,
        instanceId: instance.instance_id,
        senderPhone: from,
        messageText: text,
        correlationId: `corr_${messageId}`,
        causationId: messageId,
        eventId: `evt_${messageId}`,
        channel: "whatsapp" as const,
        traceContext: trace,
        instance,
      };

      // P0: Return 200 to Meta IMMEDIATELY before LLM inference.
      // Meta requires 200 within 20 seconds. LLM can take 8-15s.
      // Returning after inference guarantees timeout → Meta retry storm.
      // The function continues executing after res.json() in Vercel Node runtime.
      res.status(200).json({ ok: true, traceId: trace.traceId });

      // Async execution after 200 already sent — Meta will not retry
      try {
        const result = await ExecutionKernel.execute(staffLoopInput, sql, {
          apiKey: config.LLM_API_KEY,
          provider: instance.llm_config.provider as any,
          model: instance.llm_config.model,
        }, telemetry);

        if (result.deliveryContract) {
          const deliveryConfig = {
            phoneNumberId: phoneNumberId,
            accessToken: config.WHATSAPP_ACCESS_TOKEN
          };
          await DeliveryGuaranteeLayer.execute(result.deliveryContract, sql, deliveryConfig, telemetry);
        } else {
          telemetry.record("DGL_INVARIANT_VIOLATION", { reason: "MISSING_CONTRACT" });
          console.error("[WEBHOOK] DGL_INVARIANT_VIOLATION: kernel returned no delivery contract");
        }

        telemetry.complete("COMPLETED");
      } catch (execErr: unknown) {
        const execMsg = execErr instanceof Error ? execErr.message : String(execErr);
        console.error("[WEBHOOK] ASYNC_EXECUTION_FAILED:", execMsg);
        telemetry.record("ASYNC_EXECUTION_FAILED", { error: execMsg.slice(0, 120) });
        // 200 already sent — log for recovery worker to pick up
      }

    } finally {
      await sql.end();
    }

  } catch (outerErr: unknown) {
    console.error(`[FATAL_INBOUND_CRASH]`, outerErr);
    const outerMsg = outerErr instanceof Error ? outerErr.message : String(outerErr);
    return res.status(500).json({ ok: false, error: "Universal Guard Triggered", detail: outerMsg });
  }
}

function validateSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const received = signature.slice(7);
  return expected.length === received.length &&
    timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}
