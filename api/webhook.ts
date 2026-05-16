/**
 * api/webhook.ts
 * ROOT PROMOTION (WhatsApp Webhook)
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { validateConfig } from "@chioma/infrastructure/config/index.js";
import { createDatabaseClient } from "@chioma/infrastructure/database/index.js";
import { sendWhatsAppMessage } from "@chioma/infrastructure/whatsapp/index.js";
import { TelemetryManager, createTraceContext } from "@chioma/core/telemetry/index.js";
import { resolveInstance } from "@chioma/core/routing/instance-router.js";
import { isFounderNumber } from "@chioma/core/founder/control-plane.js";
import { handleFounderTelegramMessage } from "@chioma/core/founder/control-plane.js";
import { ExecutionKernel } from "@chioma/core/kernel/execution-kernel.js";
import { DeliveryGuaranteeLayer } from "@chioma/core/delivery/index.js";

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
        // Simplified founder acknowledgement for root proxy
        await sendWhatsAppMessage(
          phoneNumberId,
          config.WHATSAPP_ACCESS_TOKEN,
          from,
          "👑 *SUPREME ACCESS GRANTED*\n\nWelcome, Founder. The CHIOMA Real-time Kernel is online.",
          trace
        );
        telemetry.complete("COMPLETED");
        return res.status(200).json({ ok: true, plane: "FOUNDER_CONTROL" });
      }
      const instance = await resolveInstance(sql, phoneNumberId);
      if (!instance) {
        telemetry.record("INSTANCE_NOT_FOUND", { phoneNumberId });
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

      res.status(200).json({ ok: true, traceId: trace.traceId });

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
        }

        telemetry.complete("COMPLETED");
      } catch (execErr: unknown) {
        const execMsg = execErr instanceof Error ? execErr.message : String(execErr);
        console.error("[WEBHOOK] ASYNC_EXECUTION_FAILED:", execMsg);
        telemetry.record("ASYNC_EXECUTION_FAILED", { error: execMsg.slice(0, 120) });
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
