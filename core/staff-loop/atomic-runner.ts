import { randomUUID, createHash } from "node:crypto";
import { runStaffLoop } from "./index.js";
import { appendEvent, getNextSequenceNumber, buildContentHash } from "../events/index.js";
import { processOnboardingStep } from "../../services/onboarding-service/index.js";
import { processDailyBriefStep } from "../../services/daily-briefing-service/index.js";
import { 
  StaffLoopInput, 
  StaffLoopResult, 
  EmployabilityProfile
} from "../contracts/index.js";
import { TelemetryManager } from "../telemetry/index.js";
import { acquireLease, releaseLease } from "../concurrency/index.js";
import { buildActiveCommitmentContext } from "../commitments/acil.js";
import { deductCredit } from "../billing/gate.js";

/**
 * Resolves the Employability Profile for a tenant.
 */
async function resolveEmployabilityProfile(
  tx: any,
  tenantId: string
): Promise<EmployabilityProfile> {
  const [profile]: (EmployabilityProfile | undefined)[] = await tx`
    SELECT business_name, tone_profile, response_style, escalation_contact, working_hours 
    FROM employer_profiles WHERE tenant_id = ${tenantId}
  `;

  if (!profile) {
    throw new Error(`PROFILE_MISSING: No employability profile found for tenant ${tenantId}`);
  }

  return profile;
}

/**
 * CHIOMA ATOMIC RUNNER (THE PURE EXECUTOR)
 * This module is a slave to the Execution Kernel's State Engine.
 * It strictly executes the mode pre-determined by the Kernel.
 */
export async function runAtomicStaffLoop(
  input: StaffLoopInput,
  sql: any,
  config: { apiKey: string; provider: string; model: string },
  telemetry: TelemetryManager
): Promise<StaffLoopResult> {
  const start = Date.now();
  const correlationId = input.correlationId || `corr_${input.messageId}`;
  const aggregateId = `conv_${input.senderPhone}`;
  const workerId = input.traceContext?.workerId ?? `worker_${randomUUID().slice(0,8)}`;

  let leaseToken: number | null = null;

  try {
    const result = await sql.begin(async (tx: any) => {
      // 1. CONCURRENCY CONTROL
      const lease = await acquireLease(tx, aggregateId, workerId);
      if (!lease) {
        return {
          responseText: "I'm already working on your request. Just a moment!",
          responseType: "conversation",
          delivered: false,
          latencyMs: Date.now() - start,
          correlationId,
        };
      }
      leaseToken = lease.fencingToken;

      // 2. LEDGER INITIALIZATION
      await tx`
        UPDATE message_ledger 
        SET status = 'PROCESSING', 
            updated_at = NOW(),
            payload = ${tx.json({ ...input })}
        WHERE message_id = ${input.messageId}
      `;

      // 3. MODE-BASED DISPATCH
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

      // 4. BILLING SETTLEMENT
      if (loopResult.responseType === 'conversation') {
        await deductCredit(tx, input.instanceId, input.tenantId, correlationId, 1);
      }

      // 5. AUDIT LOGGING (Event Sourcing)
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
      
      return loopResult;
    });

    if (leaseToken) await releaseLease(sql, aggregateId, workerId, leaseToken);
    return result;

  } catch (err: any) {
    console.error(`[ATOMIC_RUNNER] FAULT: ${err.message}`);
    if (leaseToken) await releaseLease(sql, aggregateId, workerId, leaseToken).catch(() => {});
    
    // Recovery Ledger recording for automatic re-execution
    try {
      await sql`
        INSERT INTO public.execution_failures (
          tenant_id, message_id, customer_phone, input_text, correlation_id, channel
        ) VALUES (
          ${input.tenantId}, ${input.messageId}, ${input.senderPhone}, ${input.messageText}, ${correlationId}, ${input.channel}
        )
      `;
    } catch { }

    return {
      responseText: (input.state.intent.mode === 'CONTINUATION_ONLY' || input.state.intent.mode === 'COMMITMENT_RESOLUTION')
        ? "Still pulling that together for you — give me just a moment."
        : "I'm still pulling that together for you — one moment.",
      responseType: "error_degraded",
      delivered: false,
      latencyMs: Date.now() - start,
      correlationId: correlationId,
    };
  }
}
