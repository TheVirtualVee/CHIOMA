import { randomUUID, createHash } from "node:crypto";
import { runStaffLoop } from "./index.js";
import { appendEvent, getNextSequenceNumber, buildContentHash } from "../events/index.js";
import { DecisionCompiler } from "../llm/index.js";
import { classify, compensate } from "../failures/index.js";
import { assertLegalTransition, validateInvariants } from "../kernel/index.js";
import { evaluateEmployeePerformance } from "../staff-rules/performance-scorer.js";
import { enforceEmployeePsychology } from "../staff-rules/behavioral-enforcer.js";
import { processOnboardingStep } from "../../services/onboarding-service/index.js";
import { processDailyBriefStep } from "../../services/daily-briefing-service/index.js";
import { StaffLoopInput, StaffLoopResult, EmployabilityProfile, ExecutionMode } from "../contracts/index.js";
import { TelemetryManager } from "../telemetry/index.js";
import { acquireLease, releaseLease } from "../concurrency/index.js";
import { buildActiveCommitmentContext } from "../commitments/acil.js";
import { RealityGovernor } from "../reality/governor.js";
import { deductCredit } from "../billing/gate.js";
import { runArbiter } from "../arbiter/index.js";
import { ExecutionRequest } from "../contracts/index.js";
import { getCanonicalIdentity } from "../identity/index.js";

export async function runAtomicStaffLoop(
  input: StaffLoopInput,
  sql: any,
  config: { apiKey: string; provider: string; model: string },
  telemetry: TelemetryManager
): Promise<StaffLoopResult> {
  // 🧠 CRITICAL: Immediate entry log for observability
  telemetry.record("ATOMIC_RUNNER_ENTRY", { messageId: input.messageId });
  
  const start = Date.now();
  const correlationId = input.correlationId || `corr_${input.messageId}`;

  // ── TOP-LEVEL FAULT BOUNDARY ──────────────────────────────────
  // GUARANTEE: CHIOMA always responds, even during infrastructure failure.
  // Pre-lease operations (identity, arbiter, DB) can all throw.
  // Without this boundary, a DB timeout = silent customer abandonment.
  try {

  const aggregateId = `conv_${input.senderPhone}`;
  
  // ASSERT: traceContext optional — prevent crash before acquireLease when absent
  const workerId = input.traceContext?.workerId ?? ("worker_" + (input.messageId || "unknown").slice(0, 8));
  
  telemetry.record("ATOMIC_RUNNER_STARTED", { aggregateId, correlationId, workerId });

  // 🧠 IDENTITY CANONICALIZATION (Phase 3.3)
  const identityId = await getCanonicalIdentity(sql, input.tenantId, input.senderPhone);
  telemetry.record("IDENTITY_RESOLVED", { identityId });

  // ── EXECUTION ARBITER (CEA) GATE ───────────────────────────────
  // Note: We run this BEFORE acquireLease to ensure arbitration is the first door.
  telemetry.record("ARBITER_GATING_STARTED");
  
  // Check for competing scheduler active (any existing unexpired lease)
  const [activeLease] = await sql`
    SELECT worker_id FROM public.concurrency_leases 
    WHERE aggregate_id = ${aggregateId} 
      AND expires_at > NOW()
      AND worker_id != ${workerId}
    LIMIT 1
  `;

  const [commitmentData] = await sql`
    SELECT count(*)::int as active_count, 
           EXISTS(SELECT 1 FROM public.commitments WHERE tenant_id = ${input.tenantId} AND aggregate_id = ${aggregateId} AND status = 'PENDING') as has_pending
    FROM public.commitments 
    WHERE tenant_id = ${input.tenantId} 
      AND aggregate_id = ${aggregateId} 
      AND status = 'PENDING'
  `;

  const normalizedBody = input.messageText.trim().toLowerCase();
  const fingerprint = createHash("sha256")
    .update(input.tenantId + input.instanceId + input.messageId + normalizedBody)
    .digest("hex");

  const arbiterRequest: ExecutionRequest = {
    tenantId: input.tenantId,
    instanceId: input.instanceId,
    triggeredBy: input.messageText.startsWith("/") ? "daily_brief" : "whatsapp_message",
    commitmentPending: commitmentData?.has_pending ?? false,
    activeCommitmentCount: commitmentData?.active_count ?? 0,
    creditBalance: input.instance?.credit_units ?? 0,
    creditRequired: 1,
    tenantStatus: (input.instance?.billing_state.toLowerCase() as any) || "active",
    safetyFlags: [], // TODO: Integrate safety classifier
    requestedAt: Date.now(),
    fingerprint,
    identityId,
    schedulerConflict: !!activeLease
  };

  const verdict = await runArbiter(arbiterRequest, sql, config.apiKey);
  telemetry.record("ARBITER_GATING_FINISHED", { 
    outcome: verdict.outcome, 
    fingerprint: verdict.fingerprint,
    trace: verdict.gateTrace 
  });

  if (verdict.outcome === 'BLOCK_RESPONSE') {
    // If it's a scheduler conflict, we return a gentle deferral
    const isConflict = verdict.controllerTriggered === 'Gate0_Arbitration';
    return {
      responseText: isConflict 
        ? "I'm already working on your request. Just a moment!"
        : "Your account requires attention. Please contact support.",
      responseType: "conversation",
      delivered: false,
      latencyMs: Date.now() - start,
      correlationId,
    };
  }

  if (verdict.outcome === 'DEGRADE_RESPONSE') {
    return {
      responseText: "I'm having a bit of trouble right now. Please try again later.",
      responseType: "error_degraded",
      delivered: false,
      latencyMs: Date.now() - start,
      correlationId,
    };
  }

  // Acquire concurrency lease with fencing token
  const lease = await acquireLease(sql, aggregateId, workerId);
  if (!lease) {
    telemetry.record("CONCURRENCY_GATE_LOCKED", { aggregateId });
    return {
      responseText: "I'm already working on your request. Just a moment!",
      responseType: "conversation",
      delivered: false,
      latencyMs: Date.now() - start,
      correlationId: correlationId,
    };
  }
  telemetry.record("EXECUTION_LEASE_ACQUIRED", { fencingToken: lease.fencingToken });


  try {
    const result = await sql.begin(async (tx: any) => {
      // 1. LEDGERED Stage
      assertLegalTransition("INGESTED", "LEDGERED");
      await tx`
        UPDATE message_ledger 
        SET status = 'PROCESSING', 
            updated_at = NOW(),
            payload = ${tx.json({ ...input })}
        WHERE message_id = ${input.messageId}
      `;

      // Onboarding Bypass
      const onboarding = await processOnboardingStep(tx, input.tenantId, input.messageText);
      if (!onboarding.completed) {
        await tx`UPDATE message_ledger SET status = 'COMPLETED', updated_at = NOW() WHERE message_id = ${input.messageId}`;
        return {
          responseText: onboarding.response,
          responseType: "onboarding",
          delivered: false,
          latencyMs: Date.now() - start,
          correlationId: correlationId,
        };
      }

      const [profile]: (EmployabilityProfile | undefined)[] = await tx`
        SELECT business_name, tone_profile, response_style, escalation_contact, working_hours 
        FROM employer_profiles WHERE tenant_id = ${input.tenantId}
      `;
      if (!profile) throw new Error("STATE_INCONSISTENCY: Onboarding complete but profile missing.");

      // 🧠 LOAD STATE: Fetch customer memory early for Execution Mode Gate
      let state: any = null;
      try {
        const [stateRow]: any[] = await tx`
          SELECT last_customer_need, current_goal 
          FROM public.customer_memory 
          WHERE tenant_id = ${input.tenantId} AND customer_phone = ${input.senderPhone}
        `;
        state = stateRow ?? null;
      } catch (stateErr: unknown) {
        telemetry.record("STATE_LOOKUP_FAILED", { reason: String(stateErr).slice(0, 80) });
      }

      // 2. PROPOSED Stage (Inference)
      assertLegalTransition("LEDGERED", "PROPOSED");
      telemetry.record("INFERENCE_STARTED", { provider: config.provider });
      
      const governor = new RealityGovernor(tx);
      
      // ── TEMPORAL ROUTING ──
      // ASSERT: business_snapshots may not exist yet (pre-onboarding tenants).
      // Wrap in try/catch — missing table must degrade gracefully, not crash.
      let snapshotId = input.snapshotId;
      let activeSnapshotData = null;

      try {
        if (snapshotId) {
          const historical = await governor.getSnapshotById(snapshotId);
          activeSnapshotData = historical?.data;
        } else {
          const active = await governor.getActiveSnapshot(input.tenantId);
          snapshotId = active?.id;
          activeSnapshotData = active?.data;
        }
      } catch (snapshotErr: unknown) {
        // Table may not exist yet or tenant has no snapshot — continue without it
        telemetry.record("SNAPSHOT_UNAVAILABLE", { reason: String(snapshotErr).slice(0, 80) });
        snapshotId = undefined;
        activeSnapshotData = null;
      }

      // ── DAILY BRIEFING COMMAND ──────────────────────────────────────
      if (input.messageText.toLowerCase().trim() === "/daily brief") {
        telemetry.record("DAILY_BRIEF_TRIGGERED");
        await tx`
          INSERT INTO public.daily_brief_sessions (tenant_id, status)
          VALUES (${input.tenantId}, 'AWAITING_INPUT')
        `;
        await tx`UPDATE message_ledger SET status = 'COMPLETED', updated_at = NOW() WHERE message_id = ${input.messageId}`;
        return {
          responseText: "Ready for today's update.",
          responseType: "conversation",
          delivered: false,
          latencyMs: Date.now() - start,
          correlationId,
        };
      }

      // ── DAILY BRIEFING SESSION HANDLING ────────────────────────────
      const brief = await processDailyBriefStep(tx, input.tenantId, input.messageText, { apiKey: config.apiKey });
      if (brief.handled) {
        await tx`UPDATE message_ledger SET status = 'COMPLETED', updated_at = NOW() WHERE message_id = ${input.messageId}`;
        return {
          responseText: brief.response || "",
          responseType: "conversation",
          delivered: false,
          latencyMs: Date.now() - start,
          correlationId,
        };
      }

      // Handle QUEUE_FOR_RECOVERY or context overrides
      const extraContext = verdict.contextOverride ? `\n\n[ARBITER_OVERRIDE]: ${verdict.contextOverride}` : "";

      // ── ACIL: Active Commitment Injection ───────────────────────
      let activeCommitmentContext = "";
      try {
        activeCommitmentContext = await buildActiveCommitmentContext(tx, input);
      } catch (acilErr: unknown) {
        telemetry.record("ACIL_LOOKUP_FAILED", { reason: String(acilErr).slice(0, 80) });
      }

      // ── EXECUTION MODE GATE (CESM) ──────────────────────────────
      // ASSERT: Determine structural generation constraints before LLM runs.
      let executionMode: ExecutionMode = "GREETING_ALLOWED";
      
      if (activeCommitmentContext) {
        executionMode = "COMMITMENT_RESOLUTION";
      } else if (state?.last_customer_need || state?.current_goal) {
        executionMode = "CONTINUATION_ONLY";
      }

      telemetry.record("EXECUTION_MODE_SET", { mode: executionMode });

      const loopResult = await runStaffLoop({
        ...input,
        messageText: input.messageText + extraContext,
        executionMode
      }, tx, config, profile, activeCommitmentContext); // ← Pass context as argument
      telemetry.record("INFERENCE_COMPLETED", { latencyMs: loopResult.latencyMs });
      
      // ASSERT: return fallback instead of throw — throw kills the TX and
      // returns degraded text that never reaches delivery when phoneNumberId is also missing.
      if (!loopResult.decision) {
        telemetry.record("COGNITION_FALLBACK", { reason: "LLM_NO_DECISION" });
        await tx`UPDATE message_ledger SET status = 'COMPLETED', updated_at = NOW() WHERE message_id = ${input.messageId}`;
        return {
          responseText: "Thanks for your message! I'm looking into that for you.",
          responseType: "error_degraded" as const,
          delivered: false,
          latencyMs: Date.now() - start,
          correlationId,
        };
      }

      telemetry.record("CONSTITUTION_VALIDATED");
      // NOTE: Full mode-aware behavioral enforcement already happened inside runStaffLoop.
      // This second pass exists only for performance scoring. It runs in GREETING_ALLOWED
      // mode intentionally — it's measuring the LLM's raw output quality, not enforcing policy.
      const audit = enforceEmployeePsychology(loopResult.decision.response_payload);
      telemetry.record("BEHAVIORAL_ENFORCER_PASSED", { violations: audit.violations.length });
      
      const evaluation = evaluateEmployeePerformance(loopResult.decision, audit, loopResult.latencyMs);

      const seq = await getNextSequenceNumber(tx, aggregateId);

      const messageReceivedEvent = {
        eventId: input.eventId,
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
        causationId: input.correlationId,
        correlationId,
        ledgerEntryId: input.messageId,
        occurredAt: new Date().toISOString(),
        schemaVersion: 1,
        contentHash: "",
      };
      messageReceivedEvent.contentHash = buildContentHash(messageReceivedEvent.payload);
      await appendEvent(tx, messageReceivedEvent);
      
      const proposalEvent = {
        eventId: randomUUID(),
        tenantId: input.tenantId,
        aggregateId,
        aggregateType: "CONVERSATION" as const,
        sequenceNumber: seq + 1,
        type: "PROPOSAL_GENERATED" as const,
        causationId: messageReceivedEvent.eventId,
        correlationId,
        ledgerEntryId: input.messageId,
        occurredAt: new Date().toISOString(),
        schemaVersion: 1,
        payload: {
          proposalId: loopResult.decision.decision_hash,
          modelVersion: "llama-3.3-70b",
          promptVersion: "staff-v2",
          inferenceLatencyMs: loopResult.latencyMs,
          confidenceScore: loopResult.decision.confidence,
          performanceScore: evaluation.overallScore,
          performanceGrade: evaluation.grade,
          behavioralFlags: audit.violations.map(v => v.rule),
          lawViolations: evaluation.lawViolations,
          operationalFlags: evaluation.operationalFlags,
          proposal: loopResult.decision
        },
        contentHash: ""
      };
      proposalEvent.contentHash = buildContentHash(proposalEvent.payload);
      await appendEvent(tx, proposalEvent);
      telemetry.record("DECISION_COMPILED", { decisionId: loopResult.decision.decision_hash });
      
      // 🧠 STATE PERSISTENCE: Update customer memory with latest intent/goal
      // This is what prevents CHIOMA from resetting the session on every turn.
      try {
        await tx`
          INSERT INTO public.customer_memory (tenant_id, customer_phone, last_customer_need, current_goal, updated_at)
          VALUES (${input.tenantId}, ${input.senderPhone}, ${loopResult.decision.customer_need}, ${loopResult.decision.intent_type}, NOW())
          ON CONFLICT (tenant_id, customer_phone) DO UPDATE
          SET last_customer_need = EXCLUDED.last_customer_need,
              current_goal = EXCLUDED.current_goal,
              updated_at = EXCLUDED.updated_at
        `;
        telemetry.record("MEMORY_PERSISTED", { need: loopResult.decision.customer_need });
      } catch (memErr: unknown) {
        telemetry.record("MEMORY_PERSIST_FAILED", { reason: String(memErr).slice(0, 80) });
      }

      // 3. VALIDATED Stage
      assertLegalTransition("PROPOSED", "VALIDATED");
      const compiler = new DecisionCompiler();
      const proposal = {
        proposalId: loopResult.decision.decision_hash,
        intents: [{ intent: "INFORM" as const, confidence: loopResult.decision.confidence }],
        primaryIntent: "INFORM" as const,
        overallConfidence: loopResult.decision.confidence,
        proposedActions: loopResult.decision.required_actions.map(a => ({
          type: "SEND_MESSAGE" as const,
          recipientId: input.senderPhone,
          content: loopResult.decision?.response_payload || "",
          urgency: a.urgency === "URGENT" || a.urgency === "HIGH" ? ("HIGH" as const) : ("NORMAL" as const)
        })),
        reasoning: "Legacy loop migration"
      };

      const plan = compiler.compile(proposal, { stage: "VALIDATED", idempotencyKey: input.messageId });
      if ("rejected" in plan) {
        throw new Error(`BUSINESS_RULE_VIOLATION: ${plan.reasons.join(", ")}`);
      }

      const planEvent = {
        eventId: randomUUID(),
        tenantId: input.tenantId,
        aggregateId,
        aggregateType: "CONVERSATION" as const,
        sequenceNumber: seq + 2,
        type: "ACTION_PLAN_COMPILED" as const,
        causationId: proposalEvent.eventId,
        correlationId,
        ledgerEntryId: input.messageId,
        occurredAt: new Date().toISOString(),
        schemaVersion: 1,
        payload: {
          planId: plan.planId,
          rulesApplied: ["LEGACY_COMPATIBILITY"],
          overridesApplied: [],
          compiledAt: plan.compiledAt
        },
        contentHash: ""
      };
      planEvent.contentHash = buildContentHash(planEvent.payload);
      await appendEvent(tx, planEvent);
      telemetry.record("EVENT_COMMITTED", { type: planEvent.type });

      // 4. COMMITTED & EXECUTED Stages
      assertLegalTransition("VALIDATED", "COMMITTED");
      assertLegalTransition("COMMITTED", "EXECUTED");

      for (const action of plan.actions) {
        const sideEffectId = randomUUID();
        const idempotencyKey = createHash("sha256").update(planEvent.eventId + action.actionId).digest("hex");
        
        await tx`
          INSERT INTO side_effects (
            side_effect_id, tenant_id, originating_event_id, idempotency_key,
            effect_type, payload, status
          ) VALUES (
            ${sideEffectId}, ${input.tenantId}, ${planEvent.eventId}, ${idempotencyKey},
            ${action.effectType}, ${tx.json(action.payload)}, 'PENDING'
          )
        `;

        await appendEvent(tx, {
          eventId: randomUUID(),
          tenantId: input.tenantId,
          aggregateId,
          aggregateType: "CONVERSATION" as const,
          sequenceNumber: seq + 3,
          type: "SIDE_EFFECT_DISPATCHED" as const,
          causationId: planEvent.eventId,
          correlationId,
          ledgerEntryId: input.messageId,
          occurredAt: new Date().toISOString(),
          schemaVersion: 1,
          payload: { sideEffectId, effectType: action.effectType, targetId: input.senderPhone },
          contentHash: buildContentHash({ sideEffectId, effectType: action.effectType, targetId: input.senderPhone })
        });
      }
      
      // 🧠 COMMITMENT EXTRACTION (Accountability Ledger)
      // ASSERT: Wrap in try/catch — commitments table may not exist in all deployments.
      // Commitment creation failure must NEVER block message delivery.
      if (loopResult.decision?.required_actions) {
        for (const action of loopResult.decision.required_actions) {
          if (action.type === "PROMISE_MADE" || action.type === "SCHEDULE_FOLLOWUP") {
            try {
              const deadline = new Date();
              deadline.setMinutes(deadline.getMinutes() + (action.urgency === "URGENT" ? 15 : 60));

              await tx`
                INSERT INTO public.commitments (
                  tenant_id, aggregate_id, type, status, 
                  deadline_at, correlation_id, context, 
                  originating_event_id, snapshot_id
                ) VALUES (
                  ${input.tenantId}, ${aggregateId}, ${action.type}, 'PENDING', 
                  ${deadline.toISOString()}, ${correlationId}, 
                  ${tx.json(action)}, ${proposalEvent.eventId}, ${snapshotId ?? null}
                )
              `;
              telemetry.record("COMMITMENT_CREATED", { type: action.type, snapshotId });
            } catch (commitErr: unknown) {
              // Non-fatal: commitment tracking is accountability, not delivery
              telemetry.record("COMMITMENT_CREATE_FAILED", { type: action.type, reason: String(commitErr).slice(0, 80) });
            }
          }
        }
      }

      // 5. FINALIZED Stage
      assertLegalTransition("EXECUTED", "FINALIZED");
      await tx`UPDATE message_ledger SET status = 'COMPLETED', updated_at = NOW() WHERE message_id = ${input.messageId}`;
      
      validateInvariants({ stage: "FINALIZED", idempotencyKey: input.messageId });

      telemetry.record("FINALIZATION_DONE", { resultType: loopResult.responseType });
      return loopResult;
    });

    await releaseLease(sql, aggregateId, workerId, lease.fencingToken);
    return result;

  } catch (err: any) {
    if (lease) await releaseLease(sql, aggregateId, workerId, lease.fencingToken);
    const failure = classify(err);
    telemetry.record("EXECUTION_HALTED", { class: failure.class, message: err.message });

    try {
      await sql.begin(async (tx: any) => {
        await tx`
          INSERT INTO failure_logs (message_id, tenant_id, input_text, failure_type, metadata)
          VALUES (${input.messageId}, ${input.tenantId}, ${input.messageText}, ${failure.class}, ${tx.json({ error: err.message, failureId: failure.failureId })})
        `;
        
        await tx`UPDATE message_ledger SET status = 'FAILED', updated_at = NOW() WHERE message_id = ${input.messageId}`;
        await compensate(tx, failure, { messageId: input.messageId, tenantId: input.tenantId });
      });
    } catch (dbErr) {
      console.error(`[ATOMIC_RUNNER] FATAL_DB_FAILURE_IN_CATCH: ${dbErr}`);
    }

    const fallbackResponse: StaffLoopResult = {
      responseText: "I'm having a bit of trouble processing that. Let me get someone to help you.",
      responseType: "error_degraded",
      delivered: false,
      latencyMs: Date.now() - start,
      correlationId: correlationId,
    };

    telemetry.record("FINALIZATION_DONE", { resultType: "error_degraded", error: err.message });
    return fallbackResponse;
  }

  // ── END TOP-LEVEL FAULT BOUNDARY ──────────────────────────────
  } catch (outerErr: any) {
    // This catches failures in pre-lease operations: identity resolution,
    // arbiter gating, lease acquisition, or any other code path that runs
    // before the inner try/catch. Without this, the customer gets silence.
    const msg = outerErr instanceof Error ? outerErr.message : String(outerErr);
    telemetry.record("OUTER_FAULT_BOUNDARY", { error: msg.slice(0, 200) });
    console.error(`[ATOMIC_RUNNER] OUTER_FAULT_BOUNDARY: ${msg}`);
    return {
      responseText: "I'm having a bit of trouble right now, but I've noted your message. I'll follow up shortly.",
      responseType: "error_degraded" as const,
      delivered: false,
      latencyMs: Date.now() - start,
      correlationId,
    };
  }
}
