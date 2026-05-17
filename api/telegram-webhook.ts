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
  getConversationState,
  resolveSpeaker,
  checkEscalation,
  resolveTenantFromTelegram,
  detectActor
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
  const botToken = config.TELEGRAM_BOT_TOKEN ?? "";

  let sql: any;
  try {
    sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });
  } catch (err) {
    console.error("[TELEGRAM_WEBHOOK] DB connection failed:", err);
    return;
  }

  try {
    // STEP 1: Resolve Tenant (NOT owner ID)
    const tenantId = await resolveTenantFromTelegram(sql, chatId, botToken);
    if (!tenantId) {
      console.error(`[TELEGRAM_WEBHOOK] No tenant for chat ${chatId}`);
      return;
    }
    
    // STEP 2: Detect Actor
    const actor = await detectActor(sql, tenantId, senderId);
    
    // STEP 3: Log event immediately
    const [eventRecord] = await sql`
      INSERT INTO conversation_events (tenant_id, channel, channel_chat_id, channel_user_id, sender_actor, message)
      VALUES (${tenantId}, 'telegram', ${chatId}, ${senderId}, ${actor}, ${messageText})
      RETURNING id
    `;
    const eventId = eventRecord.id;
    
    // STEP 4: Handle Owner path (bypass arbitration)
    if (actor === 'owner') {
      console.log("[TELEGRAM_WEBHOOK] FOUNDER_MESSAGE: routing to control plane");

      await sql`
        UPDATE tenant_instances
        SET owner_last_seen = NOW(), owner_online_status = 'online'
        WHERE tenant_id = ${tenantId}
      `;
      
      // Some owners don't have customer_memory entries, safe update
      await sql`
        UPDATE customer_memory
        SET last_owner_at = NOW()
        WHERE tenant_id = ${tenantId} AND customer_phone = ${chatId}
      `;
      
      // Apply override lock
      await sql`
        UPDATE tenant_instances
        SET response_lock_until = NOW() + INTERVAL '10 seconds'
        WHERE tenant_id = ${tenantId}
      `;

      await handleFounderTelegramMessage(chatId, messageText, botToken, sql);
      return; // Owner message already delivered by Telegram
    }
    
    // STEP 5: Handle Customer path with Arbitration
    if (actor === 'customer' || actor === 'unknown') {
      // Ensure customer memory exists
      await sql`
        INSERT INTO customer_memory (tenant_id, customer_phone)
        VALUES (${tenantId}, ${senderId})
        ON CONFLICT (tenant_id, customer_phone) DO NOTHING
      `;
      
      const { isEscalation, keyword } = checkEscalation(messageText);

      if (isEscalation) {
        console.log(`[ARBITER] Escalation detected: "${keyword}" from customer ${senderId}`);

        const [tenantRec] = await sql`SELECT emergency_telegram_id FROM tenants WHERE tenant_id = ${tenantId}`;
        const emergencyContactId = process.env.TELEGRAM_ADMIN_CHAT_ID || tenantRec?.emergency_telegram_id;
        
        if (emergencyContactId) {
          await sql`
            INSERT INTO escalation_logs (tenant_id, chat_id, customer_message, trigger_keyword, emergency_contact_notified)
            VALUES (${tenantId}, ${chatId}, ${messageText}, ${keyword}, true)
          `;
          try {
            const fetch = globalThis.fetch;
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
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
      
      // Get state and run arbitration
      const state = await getConversationState(sql, tenantId, senderId);
      state.escalationActive = isEscalation;
      const decision = resolveSpeaker(state);
      
      console.log(`[ARBITER] Decision for chat ${chatId}: ${decision.actor} (${decision.reason})`);

      // Log arbitration decision
      await sql`
        UPDATE conversation_events
        SET resolved_actor = ${decision.actor}, arbitration_reason = ${decision.reason}
        WHERE id = ${eventId}
      `;
      
      // Execute decision
      if (decision.actor === 'CHIOMA') {
        const instance = await resolveInstanceByTenant(sql, tenantId);
        if (!instance) return;

        const trace = createTraceContext(`tg_worker_${chatId}`);
        const telemetry = new TelemetryManager(telegramMessageId, trace.traceId);
        const correlationId = randomUUID();
        const causationId = randomUUID();

        const staffLoopInput = {
          messageId: telegramMessageId,
          tenantId,
          senderPhone: chatId, 
          messageText: messageText,
          instanceId: instance.instance_id,
          correlationId,
          causationId,
          eventId: causationId,
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
              accessToken: botToken,
              provider: "telegram",
            },
            telemetry
          );

          if (result.deliveryContract.payload?.body) {
             await sql`
              INSERT INTO conversation_events (tenant_id, channel, channel_chat_id, channel_user_id, sender_actor, message)
              VALUES (${tenantId}, 'telegram', ${chatId}, 'CHIOMA', 'chioma', ${result.deliveryContract.payload.body})
            `;
          }
          
          await sql`
            UPDATE customer_memory
            SET last_chioma_at = NOW(), message_count = message_count + 1
            WHERE tenant_id = ${tenantId} AND customer_phone = ${senderId}
          `;
        }
        telemetry.complete("COMPLETED");
      } else if (decision.actor === 'NONE') {
        console.log(`[ARBITER] Suppressed: ${decision.reason}`);
      } else if (decision.actor === 'OWNER') {
        console.log(`[ARBITER] Owner should respond: ${decision.reason}`);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[TELEGRAM_WEBHOOK] EXECUTION_ERROR: ${msg}`);
  } finally {
    await sql.end().catch(() => {});
  }
}