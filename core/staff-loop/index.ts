import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { 
  StaffLoopInput, 
  StaffLoopResult,
  EmployabilityProfile,
  StaffDecision
} from "../contracts/index.js";
import { validateStaffAction, sanitizeStaffReply } from "../staff-rules/index.js";
import { processOnboardingStep } from "../../services/onboarding-service/index.js";
import { generateStaffReply } from "../../services/response-service/index.js";
import { commitEvent } from "../../infrastructure/database/index.js";
import { executeStaffDecision } from "../../services/employment-logic/index.js";

/**
 * core/staff-loop/index.ts
 *
 * THE STAFF LOOP (Authority Model v1.1)
 * Deterministic Core + Probabilistic Conversational Renderer.
 */

export async function runStaffLoop(
  input: StaffLoopInput,
  sql: postgres.Sql,
  config: { apiKey: string; provider: string }
): Promise<StaffLoopResult> {
  const start = Date.now();
  console.log("[STAFF_LOOP] START", {
    tenantId: input.tenantId,
    senderPhone: input.senderPhone,
    message: input.messageText
  });

  try {
    // 1. DETERMINISTIC ONBOARDING CHECK
    const onboarding = await processOnboardingStep(sql, input.tenantId, input.messageText);
    if (!onboarding.completed) {
      return {
        responseText: onboarding.response,
        responseType: "onboarding",
        delivered: false,
        latencyMs: Date.now() - start,
        correlationId: input.correlationId,
      };
    }

    // 2. DETERMINISTIC STATE FETCH
    const [profile] = await sql<EmployabilityProfile[]>`
      SELECT business_name, tone_profile, response_style, escalation_contact, working_hours 
      FROM employer_profiles WHERE tenant_id = ${input.tenantId}
    `;

    const [state] = await sql`SELECT last_customer_need, current_goal FROM customer_memory WHERE tenant_id = ${input.tenantId} AND customer_phone = ${input.senderPhone}`;
    const facts = await sql`SELECT key, value FROM business_facts WHERE tenant_id = ${input.tenantId} LIMIT 20`;
    
    // 3. BUSINESS BRIEF ASSEMBLY
    const businessBrief = [
      `Business Knowledge: Last goal was ${state?.current_goal || 'none'}`,
      ...facts.map(f => `${f.key}: ${JSON.stringify(f.value)}`)
    ].join("\n");
    console.log("[STAFF_LOOP] BUSINESS_CONTEXT_READY");

    // 4. CONVERSATIONAL RENDERING (Probabilistic Proposal)
    const proposedDecision = await generateStaffReply(input.messageText, businessBrief, profile || { business_name: "The Shop" });
    console.log("[STAFF_LOOP] STAFF_DECISION", proposedDecision);

    // 5. DETERMINISTIC RULE ENGINE (Operational Authority)
    const validatedAction = validateStaffAction(
      { 
        type: proposedDecision.suggested_action.type,
        urgency: proposedDecision.suggested_action.urgency,
        revenue_weight: proposedDecision.suggested_action.revenue_weight,
        need_classification: proposedDecision.suggested_action.need_classification
      },
      { 
        currentTime: new Date(), 
        profile, 
        customerState: state,
        llmConfidence: proposedDecision.confidence 
      }
    );
    console.log("[STAFF_LOOP] VALIDATED_ACTION", validatedAction);

    // 6. DETERMINISTIC POST-PROCESSING (Sanitization & Price Lock)
    const { sanitizedReply, actionOverride } = sanitizeStaffReply(proposedDecision.response, facts);

    const finalDecision: StaffDecision = {
      response: sanitizedReply,
      customer_need: proposedDecision.customer_need,
      action: actionOverride ? { ...validatedAction, type: actionOverride, urgency: "HIGH" } : validatedAction,
      confidence: proposedDecision.confidence
    };

    // 7. EXECUTION
    const outcome = await executeStaffDecision(sql, input.tenantId, input.senderPhone, finalDecision, input.correlationId);

    // 8. PERSISTENCE
    await commitEvent(sql, {
      id: randomUUID(),
      type: "STAFF_ACTION_TAKEN",
      payload: { 
        text: finalDecision.response, 
        action: finalDecision.action,
        outcome: outcome.outcome
      },
      tenantId: input.tenantId,
      correlationId: input.correlationId,
      causationId: input.eventId, // The current event is the causation for this action
    });

    return {
      responseText: finalDecision.response,
      responseType: "conversation",
      delivered: false,
      latencyMs: Date.now() - start,
      correlationId: input.correlationId,
    };

  } catch (err) {
    console.error("STAFF_LOOP_CRASH", err);
    return {
      responseText: "Sorry, I'm having a bit of trouble. Let me check that for you.",
      responseType: "error_degraded",
      delivered: false,
      latencyMs: Date.now() - start,
      correlationId: input.correlationId,
    };
  }
}


