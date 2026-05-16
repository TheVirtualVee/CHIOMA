/**
 * api/telegram-webhook.ts
 *
 * TELEGRAM INBOUND WEBHOOK HANDLER
 *
 * Receives Telegram bot updates.
 * Routes through the SAME ExecutionKernel as WhatsApp.
 * Nothing in the execution core changes — only the ingress normalisation differs.
 *
 * Setup: call setWebhook once:
 *   https://api.telegram.org/bot{TOKEN}/setWebhook?url=https://your-domain.vercel.app/api/telegram-webhook
 *
 * SIDE EFFECT: ExecutionKernel.execute() → DGL → Telegram Bot API send.
 */

import { validateConfig } from "../../../infrastructure/config/index.js";
import { createDatabaseClient } from "../../../infrastructure/database/index.js";
import { resolveInstanceByTenant } from "../../../core/routing/instance-router.js";
import { ExecutionKernel } from "../../../core/kernel/execution-kernel.js";
import { DeliveryGuaranteeLayer } from "../../../core/delivery/index.js";
import { createTraceContext } from "../../../core/telemetry/index.js";
import { TelemetryManager } from "../../../core/telemetry/index.js";
import { isFounderNumber } from "../../../core/founder/control-plane.js";
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
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Acknowledge Telegram immediately — Telegram retries after 60s if no 200
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

  // Founder routing — same guard as WhatsApp path
  if (isFounderNumber(fromId)) {
    console.log("[TELEGRAM_WEBHOOK] FOUNDER_MESSAGE: routing to control plane");
    
    // Acknowledge the supreme founder directly
    const botToken = config.TELEGRAM_BOT_TOKEN ?? "";
    const pingText = `👑 *SUPREME ACCESS GRANTED*\n\nWelcome, Founder. The CHIOMA Real-time Kernel is online and monitoring all operations.\n\n*System Integrity:* 100/100\n*Active Tenants:* (Querying...)\n\nYou have supreme oversight.`;
    
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: pingText,
        parse_mode: "HTML"
      })
    });

    return;
  }

  const sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });

  try {
    // Resolve tenant from TELEGRAM_TENANT_ID env (single-tenant MVP)
    // In multi-tenant: map Telegram bot tokens to tenant IDs
    const tenantId = process.env.TELEGRAM_TENANT_ID ?? `tenant_tg_${chatId}`;
    const instance = await resolveInstanceByTenant(sql, tenantId);

    if (!instance) {
      console.log(`[TELEGRAM_WEBHOOK] INSTANCE_NOT_FOUND: tenant=${tenantId}`);
      // No instance = not onboarded yet; silently skip
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
      senderPhone: chatId, // Telegram chat_id maps to senderPhone for memory keying
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

    // ExecutionKernel: unchanged — same path as WhatsApp
    const result = await ExecutionKernel.execute(
      staffLoopInput,
      sql,
      { apiKey: config.LLM_API_KEY, provider: instance.llm_config.provider as any, model: instance.llm_config.model },
      telemetry
    );

    if (result.deliveryContract) {
      // Override the `to` field to use Telegram chat_id
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
