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
import {
  buildConversationState,
  resolveSpeaker,
  applyOwnerOverrideLock,
  checkEscalation
} from "../core/arbitration/engine.js";

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
  
  // ✅ STEP 1: METHOD CHECK
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Verify Telegram secret token
  const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
  if (secretHeader !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    console.warn("[TELEGRAM_WEBHOOK] INVALID_SECRET from", req.headers['x-forwarded-for']);
    return res.status(200).json({ ok: true }); // Return 200 to not reveal the endpoint exists
  }

  // ✅ STEP 2: IMMEDIATE ACKNOWLEDGMENT (CRITICAL — NEVER BLOCK)
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
  const senderId = String(message.from.id);
  const messageText = message.text.trim();
  const telegramMessageId = `tg_${message.message_id}`;

  let sql: any;
  try {
    sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });
  } catch (err) {
    console.error("[TELEGRAM_WEBHOOK] DB connection failed:", err);
    return;
  }

  try {
    // ✅ STEP 4: RESOLVE TENANT AND ACTOR
    let tenantId: string;
    let actor: 'owner' | 'customer';

    const isOwner = isFounderNumber(senderId);

    if (isOwner) {
      // Owner message - route to control plane just like before
      console.log("[TELEGRAM_WEBHOOK] FOUNDER_MESSAGE: routing to control plane");
      
      // Keep using the existing behavior for routing
      tenantId = process.env.TELEGRAM_ADMIN_TENANT_ID ?? "chioma-admin";
      
      await sql`
        UPDATE public.chioma_instances
        SET owner_last_seen = NOW(),
            owner_online_status = 'online'
        WHERE tenant_id = ${tenantId}
      `;

      await sql`
        INSERT INTO conversation_events (tenant_id, chat_id, actor, message)
        VALUES (${tenantId}, ${chatId}, 'owner', ${messageText})
      `;

      await applyOwnerOverrideLock(sql, tenantId, 10);
      
      await handleFounderTelegramMessage(chatId, messageText, config.TELEGRAM_BOT_TOKEN ?? "", sql);
      return;
    }

    // ✅ STEP 5: CUSTOMER PATH
    actor = 'customer';
    tenantId = `tg-${chatId}`;

    let instance = await resolveInstanceByTenant(sql, tenantId);

    if (!instance) {
      const newTenantId = `tg-${chatId}`;
      await sql`
        INSERT INTO public.chioma_instances (
          instance_id,
          tenant_id,
          whatsapp_phone_number,
          whatsapp_phone_number_id,
          billing_state,
          credit_units,
          business_model_version,
          llm_provider,
          llm_model,
          memory_namespace
        ) VALUES (
          gen_random_uuid(),
          ${newTenantId},
          ${`tg:${chatId}`},
          ${`tg:${chatId}`},
          'ACTIVE',
          50,
          'v1',
          ${process.env.LLM_PROVIDER ?? 'groq'},
          'llama-3.3-70b-versatile',
          ${newTenantId}
        )
      `;
      tenantId = newTenantId;
      instance = await resolveInstanceByTenant(sql, tenantId);
    }

    if (!instance) {
      console.error(`[TELEGRAM_WEBHOOK] No instance for tenant ${tenantId}`);
      return;
    }

    await sql`
      INSERT INTO conversation_events (tenant_id, chat_id, actor, message)
      VALUES (${tenantId}, ${chatId}, 'customer', ${messageText})
    `;

    // ✅ STEP 6: ESCALATION CHECK
    const { isEscalation, keyword } = checkEscalation(messageText);

    if (isEscalation) {
      console.log(`[ARBITER] Escalation detected: "${keyword}" from customer ${senderId}`);

      const emergencyContactId = process.env.TELEGRAM_ADMIN_CHAT_ID || ((instance as any).emergency_telegram_id as string | undefined);
      if (emergencyContactId) {
        await sql`
          INSERT INTO escalation_logs (tenant_id, chat_id, customer_message, trigger_keyword, emergency_contact_notified)
          VALUES (${tenantId}, ${chatId}, ${messageText}, ${keyword}, true)
        `;
        try {
          const fetch = globalThis.fetch;
          await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: emergencyContactId,
              text: `🚨 ESCALATION ALERT\n\nCustomer: ${senderId}\nMessage: "${messageText.substring(0, 200)}"\n\nTrigger: ${keyword}\n\nPlease respond to this customer immediately.`
            })
          });
        } catch (e) {
          console.error("Failed to send escalation", e);
        }
      }
      return;
    }

    // ✅ STEP 7: ARBITRATION ENGINE
    const state = await buildConversationState(sql, tenantId, chatId);
    state.escalationActive = isEscalation;
    const decision = resolveSpeaker(state);

    console.log(`[ARBITER] Decision for chat ${chatId}: ${decision.actor} (${decision.reason})`);

    // ✅ STEP 8: EXECUTE DECISION
    if (decision.actor === "NONE") {
      console.log(`[ARBITER] Suppressed: ${decision.reason}`);
      return;
    }

    if (decision.actor === "OWNER") {
      console.log(`[ARBITER] Owner should respond: ${decision.reason}`);
      return;
    }

    if (decision.actor === "CHIOMA") {
      console.log(`[ARBITER] CHIOMA responding: ${decision.reason}`);

      if (decision.reason === "owner_priority_window") {
        await applyOwnerOverrideLock(sql, tenantId, 10);
      }

      // Existing staff loop setup
      const trace = createTraceContext(`tg_worker_${chatId}`);
      const telemetry = new TelemetryManager(telegramMessageId, trace.traceId);

      const correlationId = randomUUID();
      const eventId = randomUUID();

      const staffLoopInput = {
        messageId: telegramMessageId,
        tenantId,
        senderPhone: chatId, 
        messageText: messageText,
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

        if (result.deliveryContract.payload?.body) {
           await sql`
            INSERT INTO conversation_events (tenant_id, chat_id, actor, message)
            VALUES (${tenantId}, ${chatId}, 'chioma', ${result.deliveryContract.payload.body})
          `;
        }
      }

      telemetry.complete("COMPLETED");
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[TELEGRAM_WEBHOOK] EXECUTION_ERROR: ${msg}`);
  } finally {
    await sql.end().catch(() => {});
  }
}