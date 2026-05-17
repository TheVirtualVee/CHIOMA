/**
 * api/telegram-webhook.ts
 */

import { validateConfig } from "@chioma/infrastructure/config/index.js";
import { createDatabaseClient } from "@chioma/infrastructure/database/index.js";
import { resolveInstanceByTenant } from "@chioma/core/routing/instance-router.js";
import { ExecutionKernel } from "@chioma/core/kernel/execution-kernel.js";
import { DeliveryGuaranteeLayer } from "@chioma/core/delivery/index.js";
import { createTraceContext } from "@chioma/core/telemetry/index.js";
import { TelemetryManager } from "@chioma/core/telemetry/index.js";
import { isFounderNumber, handleFounderTelegramMessage } from "@chioma/core/founder/control-plane.js";
import { randomUUID } from "node:crypto";

type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; first_name?: string; username?: string };
    chat: { id: number };
    text?: string;
    date: number;
  };
};

export default async function handler(req: any, res: any) {
  console.log("[TELEGRAM_WEBHOOK] BOOT", { method: req.method, url: req.url });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Acknowledge Telegram immediately
  res.status(200).json({ ok: true });

  let config;
  try {
    config = validateConfig();
  } catch (err: unknown) {
    console.error("[TELEGRAM_WEBHOOK] CONFIG_INVALID:", String(err).slice(0, 100));
    return;
  }

  const update = req.body as TelegramUpdate;
  const message = update?.message;

  if (!message?.text || !message.chat?.id) {
    console.log("[TELEGRAM_WEBHOOK] NO_TEXT_MESSAGE: ignored");
    return;
  }

  const chatId = String(message.chat.id);
  const fromId = String(message.from.id);
  const text = message.text.trim();
  const telegramMessageId = `tg_${message.message_id}`;

  // 👑 FOUNDER CONTROL PLANE GATE
  if (isFounderNumber(fromId)) {
    console.log("[TELEGRAM_WEBHOOK] FOUNDER_MESSAGE: routing to control plane");
    await handleFounderTelegramMessage(chatId, text, config.TELEGRAM_BOT_TOKEN ?? "");
    return;
  }

  const sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });

  try {
    const tenantId = process.env.TELEGRAM_TENANT_ID ?? `tenant_tg_${chatId}`;
    const instance = await resolveInstanceByTenant(sql, tenantId);

    if (!instance) {
      console.log(`[TELEGRAM_WEBHOOK] INSTANCE_NOT_FOUND: tenant=${tenantId}`);
      await sql.end();
      return;
    }

    const trace = createTraceContext(`tg_worker_${chatId}`);
    const telemetry = new TelemetryManager(telegramMessageId, trace.traceId);

    const correlationId = randomUUID();
    const eventId = randomUUID();

    const staffLoopInput = {
      messageId: telegramMessageId,
      tenantId,
      senderPhone: chatId, 
      messageText: text,
      instanceId: instance.instance_id,
      correlationId,
      causationId: eventId,
      eventId,
      channel: "telegram" as const,
      traceContext: trace,
      instance,
      state: {
        intent: {
          active: false,
          mode: "GREETING_ALLOWED" as const,
          currentGoal: null,
          lastUserNeed: null,
          toneState: "CALM",
          messageCount: 0,
        },
        execution: {
          status: "READY" as const,
          reason: null,
          controllerTriggered: "telegram-webhook",
          fingerprint: telegramMessageId,
          contextOverride: null,
        },
        billing: { allowed: true, reason: "telegram-mvp" },
      },
    };

    const result = await ExecutionKernel.execute(
      staffLoopInput,
      sql,
      { apiKey: config.LLM_API_KEY, provider: instance.llm_config.provider as any, model: instance.llm_config.model },
      telemetry
    );

    if (result.deliveryContract) {
      if (result.deliveryContract.payload) {
        result.deliveryContract.payload.to = chatId;
      }

      await DeliveryGuaranteeLayer.execute(
        result.deliveryContract,
        sql,
        {
          phoneNumberId: undefined,
          accessToken: config.TELEGRAM_BOT_TOKEN ?? "",
          provider: "telegram",
        },
        telemetry
      );
    }

    telemetry.complete("COMPLETED");
    console.log(`[TELEGRAM_WEBHOOK] LIFECYCLE_COMPLETE: trace=${trace.traceId} state=${result.deliveryContract?.deliveryState}`);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[TELEGRAM_WEBHOOK] EXECUTION_ERROR: ${msg}`);
  } finally {
    await sql.end().catch(() => {});
  }
}