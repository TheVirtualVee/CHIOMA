import { randomUUID, createHash } from "node:crypto";
import { runStaffLoop } from "./index.js";
import { appendEvent, getNextSequenceNumber, buildContentHash } from "../events/index.js";
import { DecisionCompiler } from "../llm/index.js";
import { classify, compensate } from "../failures/index.js";
import { assertLegalTransition, validateInvariants } from "../kernel/index.js";
import { scoreEmployeePerformance } from "../staff-rules/performance-scorer.js";
import { enforceEmployeePsychology } from "../staff-rules/behavioral-enforcer.js";
import { processOnboardingStep } from "../../services/onboarding-service/index.js";
import { StaffLoopInput, StaffLoopResult, EmployabilityProfile } from "../contracts/index.js";

import { acquireLease, releaseLease } from "../concurrency/index.js";

export async function runAtomicStaffLoop(
  input: StaffLoopInput,
  sql: any,
  config: { apiKey: string; provider: string }
): Promise<StaffLoopResult> {
  const start = Date.now();
  const aggregateId = `conv_${input.senderPhone}`;
  const correlationId = input.correlationId;
  const workerId = `worker_${process.env.VERCEL_REGION || "local"}`;

  // Acquire concurrency lease with fencing token
  const lease = await acquireLease(sql, aggregateId, workerId);
  if (!lease) {
    console.log(`[CONCURRENCY_GATE] Aggregate ${aggregateId} is locked by another worker.`);
    return {
      responseText: "I'm already working on your request. Just a moment!",
      responseType: "conversation",
      delivered: false,
      latencyMs: Date.now() - start,
      correlationId: correlationId,
    };
  }

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

      // Onboarding Bypass (Legacy support for now, but wrapped in transition safety)
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

      // 2. PROPOSED Stage
      assertLegalTransition("LEDGERED", "PROPOSED");
      const loopResult = await runStaffLoop(input, tx, config, profile);
      if (!loopResult.decision) throw new Error("COGNITION_FAILURE: LLM failed to produce a decision.");

      const audit = enforceEmployeePsychology(loopResult.decision.response_payload);
      const score = scoreEmployeePerformance(loopResult.decision, audit, loopResult.latencyMs);

      const seq = await getNextSequenceNumber(tx, aggregateId);
      
      const proposalEvent = {
        eventId: randomUUID(),
        aggregateId,
        aggregateType: "CONVERSATION" as const,
        sequenceNumber: seq,
        type: "PROPOSAL_GENERATED" as const,
        causationId: input.eventId,
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
          performanceScore: score.overallScore,
          performanceGrade: score.grade,
          behavioralFlags: score.flags,
          proposal: loopResult.decision
        },
        contentHash: ""
      };
      proposalEvent.contentHash = buildContentHash(proposalEvent.payload);
      await appendEvent(tx, proposalEvent);

      // 3. VALIDATED Stage
      assertLegalTransition("PROPOSED", "VALIDATED");
      const compiler = new DecisionCompiler();
      // Map legacy decision to new proposal format for compiler
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
        aggregateId,
        aggregateType: "CONVERSATION" as const,
        sequenceNumber: seq + 1,
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

      // 4. COMMITTED & EXECUTED Stages (Atomic for the bootstrap worker)
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
          aggregateId,
          aggregateType: "CONVERSATION" as const,
          sequenceNumber: seq + 2,
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

      // 5. FINALIZED Stage
      assertLegalTransition("EXECUTED", "FINALIZED");
      await tx`UPDATE message_ledger SET status = 'COMPLETED', updated_at = NOW() WHERE message_id = ${input.messageId}`;
      
      validateInvariants({ stage: "FINALIZED", idempotencyKey: input.messageId });

      return loopResult;
    });

    await releaseLease(sql, aggregateId, workerId, lease.fencingToken);
    return result;

  } catch (err: any) {
    if (lease) await releaseLease(sql, aggregateId, workerId, lease.fencingToken);
    const failure = classify(err);
    console.error(`[ATOMIC_RUNNER] [${failure.class}] ${err.message}`);

    await sql.begin(async (tx: any) => {
      await tx`
        INSERT INTO failure_logs (message_id, tenant_id, input_text, failure_type, metadata)
        VALUES (${input.messageId}, ${input.tenantId}, ${input.messageText}, ${failure.class}, ${tx.json({ error: err.message, failureId: failure.failureId })})
      `;
      
      await compensate(tx, failure, { messageId: input.messageId, tenantId: input.tenantId });
    });

    return {
      responseText: "I'm having a bit of trouble. Let me check that for you.",
      responseType: "error_degraded",
      delivered: false,
      latencyMs: Date.now() - start,
      correlationId: correlationId,
    };
  }

  return {
    responseText: "System in indeterminate state. Please retry.",
    responseType: "error_degraded",
    delivered: false,
    latencyMs: Date.now() - start,
    correlationId: correlationId,
  };
}
