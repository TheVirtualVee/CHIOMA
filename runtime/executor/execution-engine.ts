import { RuntimeEvent } from "../ingress/event-bus.js";
import { ArbitrationOutput } from "../../core/arbitration/engine.js";
import { ExecutionKernel } from "../../core/kernel/execution-kernel.js";
import { resolveInstanceByTenant } from "../../core/routing/instance-router.js";
import { DeliveryGuaranteeLayer } from "../../core/delivery/index.js";
import { createTraceContext, TelemetryManager } from "../../core/telemetry/index.js";
import { randomUUID } from "node:crypto";
import { handleFounderTelegramMessage } from "../../core/founder/control-plane.js";

export async function executeDecision(sql: any, event: RuntimeEvent, decision: ArbitrationOutput, config: any) {
  switch (decision.actor) {
    case 'OWNER':
      return await handleOwner(sql, event, config);
    case 'CHIOMA':
      return await handleChioma(sql, event, config);
    case 'NONE':
      return logSilence(event, decision.reason);
    case 'SYSTEM':
      return await handleSystem(sql, event);
  }
}

async function handleOwner(sql: any, event: RuntimeEvent, config: any) {
  console.log(`[EXECUTION] Owner event received: ${event.channelUserId}`);
  
  await sql`
    UPDATE chioma_instances
    SET owner_last_seen = NOW(), owner_online_status = 'online', response_lock_until = NOW() + INTERVAL '10 seconds'
    WHERE tenant_id = ${event.tenantId}
  `;
  
  await sql`
    UPDATE customer_memory
    SET last_owner_at = NOW()
    WHERE tenant_id = ${event.tenantId} AND customer_phone = ${event.channelChatId}
  `;

  if (event.source === 'telegram' && event.message) {
    await handleFounderTelegramMessage(event.channelChatId, event.message, config.TELEGRAM_BOT_TOKEN, sql);
  }
  return { status: "owner_handled" };
}

async function handleChioma(sql: any, event: RuntimeEvent, config: any) {
  const instance = await resolveInstanceByTenant(sql, event.tenantId);
  if (!instance) return { status: "no_instance_found" };

  const trace = createTraceContext(`worker_${event.id}`);
  const telemetry = new TelemetryManager(event.id, trace.traceId);
  const correlationId = randomUUID();
  const causationId = randomUUID();

  const staffLoopInput = {
    messageId: event.id,
    tenantId: event.tenantId,
    senderPhone: event.channelChatId, 
    messageText: event.message || "",
    instanceId: instance.instance_id,
    correlationId,
    causationId,
    eventId: causationId,
    channel: ((event.source === 'cron' || event.source === 'system') ? 'simulation' : event.source) as "telegram" | "whatsapp" | "simulation" | "sms" | "web",
    traceContext: trace,
    instance,
    state: {
      intent: { active: false, mode: "GREETING_ALLOWED" as const, currentGoal: null, lastUserNeed: null, toneState: "CALM", messageCount: 0 },
      execution: { status: "READY" as const, reason: null, controllerTriggered: "runtime", fingerprint: event.id, contextOverride: null },
      billing: { allowed: true, reason: "runtime-mvp" },
    },
  };

  const result = await ExecutionKernel.execute(
    staffLoopInput,
    sql,
    { apiKey: config.LLM_API_KEY, provider: instance.llm_config.provider as any, model: instance.llm_config.model },
    telemetry
  );

  let deliveredText = null;

  if (result.deliveryContract && result.deliveryContract.payload) {
    result.deliveryContract.payload.to = event.channelChatId;

    await DeliveryGuaranteeLayer.execute(
      result.deliveryContract,
      sql,
      {
        phoneNumberId: undefined,
        accessToken: event.source === 'telegram' ? config.TELEGRAM_BOT_TOKEN : config.WHATSAPP_ACCESS_TOKEN,
        provider: event.source as any,
      },
      telemetry
    );

    deliveredText = result.deliveryContract.payload.body || result.deliveryContract.payload.text;

    if (deliveredText) {
       await sql`
        INSERT INTO conversation_events (tenant_id, channel, channel_chat_id, channel_user_id, sender_actor, message)
        VALUES (${event.tenantId}, ${event.source}, ${event.channelChatId}, 'CHIOMA', 'chioma', ${deliveredText})
      `;
    }
    
    await sql`
      UPDATE customer_memory
      SET last_chioma_at = NOW(), message_count = message_count + 1
      WHERE tenant_id = ${event.tenantId} AND customer_phone = ${event.channelUserId}
    `;
  }
  
  telemetry.complete("COMPLETED");
  return { status: "chioma_handled", deliveredText, internalResult: result };
}

function logSilence(event: RuntimeEvent, reason: string) {
  console.log(`[EXECUTION] Suppressed event ${event.id}: ${reason}`);
  return { status: "suppressed", reason };
}

async function handleSystem(sql: any, event: RuntimeEvent) {
  console.log(`[EXECUTION] System event handled: ${event.id}`);
  return { status: "system_handled" };
}
