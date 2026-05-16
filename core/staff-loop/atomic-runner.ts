import { randomUUID, createHash } from "node:crypto";
import { runStaffLoop } from "./index.js";
import { appendEvent, getNextSequenceNumber, buildContentHash } from "../events/index.js";
import { processOnboardingStep } from "../../services/onboarding-service/index.js";
import { processDailyBriefStep } from "../../services/daily-briefing-service/index.js";
import { 
  StaffLoopInput, 
  StaffLoopResult, 
  EmployabilityProfile,
  DeliveryContract
} from "../contracts/index.js";
import { TelemetryManager } from "../telemetry/index.js";
import { acquireLease, releaseLease } from "../concurrency/index.js";
import { buildActiveCommitmentContext } from "../commitments/acil.js";
import { deductCredit } from "../../infrastructure/database/index.js";

function getSafetyFallback(mode: string): string {
  if (mode === "CONTINUATION_ONLY" || mode === "COMMITMENT_RESOLUTION") {
    return "I apologize, I'm having a bit of trouble processing that right now. Let me look into it for you.";
  }
  return "I'm sorry, I'm unable to process that at the moment. Is there anything else I can help you with?";
}

async function resolveEmployabilityProfile(
  tx: any,
  tenantId: string
): Promise<EmployabilityProfile> {
  const [profile]: (EmployabilityProfile | undefined)[] = await tx`
    SELECT business_name, tone_profile, response_style, escalation_contact, working_hours 
    FROM employer_profiles WHERE tenant_id = ${tenantId}
  `;
  if (!profile) throw new Error(`PROFILE_MISSING: ${tenantId}`);
  return profile;
}

export async function runAtomicStaffLoop(
  input: StaffLoopInput,
  sql: any,
  config: { apiKey: string; provider: string; model: string },
  telemetry: TelemetryManager
): Promise<StaffLoopResult & { deliveryContract: DeliveryContract }> {
  const start = Date.now();
  const correlationId = input.correlationId || `corr_${input.messageId}`;
  const aggregateId = `conv_${input.senderPhone}`;
  const workerId = input.traceContext?.workerId ?? `worker_${randomUUID().slice(0,8)}`;
  let leaseToken: number | null = null;

  try {
    await sql`BEGIN`;
    const tx = sql;

    const lease = await acquireLease(tx, aggregateId, workerId);
    if (!lease) {
      await sql`ROLLBACK`;
      return {
        responseText: "I'm already working on your request. Just a moment!",
        responseType: "conversation",
        delivered: false,
        latencyMs: Date.now() - start,
        correlationId,
        deliveryContract: {
          traceId: telemetry.getTimeline().traceId,
          tenantId: input.tenantId,
          instanceId: input.instanceId,
          intent: "SEND",
          payload: { to: input.senderPhone, text: "I'm already working on your request. Just a moment!" },
          deliveryState: "PENDING"
        }
      };
    }
    leaseToken = lease.fencingToken;

    await tx`
      UPDATE message_ledger 
      SET status = 'PROCESSING', 
          updated_at = NOW(),
          payload = ${tx.json({ ...input })}
      WHERE message_id = ${input.messageId}
    `;

    const mode = input.state.intent.mode;
    telemetry.record("EXECUTOR_MODE_DISPATCH", { mode });

    let loopResult: StaffLoopResult;

    switch (mode) {
      case "ONBOARDING":
        const onboarding = await processOnboardingStep(tx, input.tenantId, input.messageText);
        loopResult = {
          responseText: onboarding.response,
          responseType: "onboarding",
          delivered: false,
          latencyMs: Date.now() - start,
          correlationId,
        };
        break;

      case "DAILY_BRIEF":
        const brief = await processDailyBriefStep(tx, input.tenantId, input.messageText, { apiKey: config.apiKey });
        loopResult = {
          responseText: brief.response || "Daily brief step processed.",
          responseType: "conversation",
          delivered: false,
          latencyMs: Date.now() - start,
          correlationId,
        };
        break;

      case "COMMITMENT_RESOLUTION":
      case "CONTINUATION_ONLY":
      case "GREETING_ALLOWED":
      default:
        const [profile, activeCommitmentContext] = await Promise.all([
          resolveEmployabilityProfile(tx, input.tenantId),
          buildActiveCommitmentContext(tx, input)
        ]);
        const extraContext = input.state.execution.contextOverride 
          ? `\n\n[ARBITER_OVERRIDE]: ${input.state.execution.contextOverride}` 
          : "";
        loopResult = await runStaffLoop({
          ...input,
          messageText: input.messageText + extraContext
        }, tx, config, profile, activeCommitmentContext);
        break;
    }

    if (!loopResult.responseText || loopResult.responseText.trim() === "") {
      telemetry.record("DELIVERY_INVARIANT_VIOLATED", { mode, reason: "EMPTY_RESPONSE" });
      loopResult.responseText = getSafetyFallback(mode);
    }

    // P1: Persist conversation state to customer_memory for the next turn.
    // This is what enables CONTINUATION_ONLY and COMMITMENT_RESOLUTION modes
    // to work correctly — without this write, every message is stateless.
    if (loopResult.responseType === 'conversation' || loopResult.responseType === 'onboarding') {
      const customerNeed = loopResult.decision?.customer_need ?? input.state.intent.lastUserNeed ?? input.messageText.slice(0, 200);
      const currentGoal = loopResult.decision?.intent_type ?? input.state.intent.currentGoal ?? "general_inquiry";
      const newMessageCount = (input.state.intent.messageCount ?? 0) + 1;

      // Detect tone from response type and behavioral signals
      const toneState = loopResult.decision?.safety_flags?.includes("FRUSTRATION_DETECTED")
        ? "FRUSTRATED"
        : loopResult.decision?.safety_flags?.includes("URGENT_SIGNAL")
        ? "URGENT"
        : input.state.intent.toneState ?? "CALM";

      try {
        await tx`
          INSERT INTO public.customer_memory
            (tenant_id, customer_phone, last_customer_need, current_goal, message_count, tone_state, updated_at)
          VALUES
            (${input.tenantId}, ${input.senderPhone}, ${customerNeed}, ${currentGoal}, ${newMessageCount}, ${toneState}, NOW())
          ON CONFLICT (tenant_id, customer_phone) DO UPDATE SET
            last_customer_need = EXCLUDED.last_customer_need,
            current_goal       = EXCLUDED.current_goal,
            message_count      = customer_memory.message_count + 1,
            tone_state         = EXCLUDED.tone_state,
            updated_at         = NOW()
        `;
        telemetry.record("MEMORY_PERSISTED", { messageCount: newMessageCount, toneState, mode });
      } catch (memErr: unknown) {
        // Non-fatal: memory persistence failure must never block delivery
        console.error("[ATOMIC_RUNNER] MEMORY_PERSIST_FAILED:", String(memErr).slice(0, 100));
      }
    }

    const dglContract: DeliveryContract = {
      traceId: telemetry.getTimeline().traceId,
      tenantId: input.tenantId,
      instanceId: input.instanceId,
      intent: "SEND",
      payload: { to: input.senderPhone, text: loopResult.responseText },
      deliveryState: "PENDING"
    };

    if (input.state.intent.mode !== ("DAILY_BRIEF" as any) && dglContract.intent !== "SEND") {
      throw new Error("[DGL_INVARIANT_VIOLATION] Missing delivery contract intent");
    }

    if (loopResult.responseType === 'conversation') {
      await deductCredit(tx, input.instanceId, input.tenantId, correlationId, 1);
    }

    const seq = await getNextSequenceNumber(tx, aggregateId);
    const messageReceivedEvent = {
      eventId: input.eventId || randomUUID(),
      tenantId: input.tenantId,
      type: "MESSAGE_RECEIVED" as const,
      payload: {
        channel: input.channel,
        from: input.senderPhone,
        text: input.messageText,
        waMessageId: input.messageId
      },
      aggregateId,
      aggregateType: "CONVERSATION" as const,
      sequenceNumber: seq,
      causationId: correlationId,
      correlationId,
      ledgerEntryId: input.messageId,
      occurredAt: new Date().toISOString(),
      schemaVersion: 1,
      contentHash: "",
    };
    messageReceivedEvent.contentHash = buildContentHash(messageReceivedEvent.payload);
    await appendEvent(tx, messageReceivedEvent);

    await tx`UPDATE message_ledger SET status = 'COMPLETED', updated_at = NOW() WHERE message_id = ${input.messageId}`;
    
    await sql`COMMIT`;
    if (leaseToken) await releaseLease(sql, aggregateId, workerId, leaseToken);
    
    telemetry.record("EXECUTION_FINALIZED", { responseType: loopResult.responseType });
    return { ...loopResult, deliveryContract: dglContract };

  } catch (err: any) {
    await sql`ROLLBACK`;
    console.error(`[ATOMIC_RUNNER] FAULT: ${err.message}`);
    if (leaseToken) await releaseLease(sql, aggregateId, workerId, leaseToken).catch(() => {});
    try {
      await sql`
        INSERT INTO public.execution_failures (
          tenant_id, message_id, customer_phone, input_text, correlation_id, channel
        ) VALUES (
          ${input.tenantId}, ${input.messageId}, ${input.senderPhone}, ${input.messageText}, ${correlationId}, ${input.channel}
        )
      `;
    } catch { }

    const degradedText = (input.state.intent.mode === 'CONTINUATION_ONLY' || input.state.intent.mode === 'COMMITMENT_RESOLUTION')
      ? "Still pulling that together for you — give me just a moment."
      : "I'm still pulling that together for you — one moment.";

    telemetry.record("EXECUTION_DEGRADED", { error: err.message });
    return {
      responseText: degradedText,
      responseType: "error_degraded",
      delivered: false,
      latencyMs: Date.now() - start,
      correlationId: correlationId,
      deliveryContract: {
        traceId: telemetry.getTimeline().traceId,
        tenantId: input.tenantId,
        instanceId: input.instanceId,
        intent: "SEND",
        payload: { to: input.senderPhone, text: degradedText },
        deliveryState: "PENDING"
      }
    };
  }
}
