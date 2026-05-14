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

console.log("[STAFF_LOOP] MODULE_LOADED");

/**
 * core/staff-loop/index.ts
 *
 * THE STAFF LOOP (Authority Model v1.1)
 * HARD TRACING BUILD — isolates exact failure in orchestration.
 */

export async function runStaffLoop(
  input: StaffLoopInput,
  sql: postgres.Sql,
  config: { apiKey: string; provider: string }
): Promise<StaffLoopResult> {
  console.log("[STAFF_LOOP] FUNCTION_ENTER");
  
  const start = Date.now();
  const trace: string[] = [];
  const t = (m: string) => { 
    trace.push(`[${Date.now() - start}ms] ${m}`); 
    console.log(`[STAFF_LOOP_TRACE] ${m}`);
  };

  t("START_LOOP");

  try {
    // 1. DETERMINISTIC ONBOARDING CHECK
    t("CHECKING_ONBOARDING");
    const onboarding = await processOnboardingStep(sql, input.tenantId, input.messageText);
    t("ONBOARDING_STATUS:" + onboarding.completed);

    if (!onboarding.completed) {
      t("ONBOARDING_INCOMPLETE_EXIT");
      return {
        responseText: onboarding.response,
        responseType: "onboarding",
        delivered: false,
        latencyMs: Date.now() - start,
        correlationId: input.correlationId,
      };
    }

    // 2. DETERMINISTIC STATE FETCH
    t("FETCHING_PROFILE");
    const [profile] = await sql<EmployabilityProfile[]>`
      SELECT business_name, tone_profile, response_style, escalation_contact, working_hours 
      FROM employer_profiles WHERE tenant_id = ${input.tenantId}
    `;
    t("PROFILE_FETCHED:" + !!profile);

    t("FETCHING_CUSTOMER_STATE");
    const [state] = await sql`SELECT last_customer_need, current_goal FROM customer_memory WHERE tenant_id = ${input.tenantId} AND customer_phone = ${input.senderPhone}`;
    t("STATE_FETCHED:" + !!state);

    t("FETCHING_FACTS");
    const facts = await sql`SELECT key, value FROM business_facts WHERE tenant_id = ${input.tenantId} LIMIT 20`;
    t("FACTS_FETCHED:" + facts.length);
    
    // 3. BUSINESS BRIEF ASSEMBLY
    t("ASSEMBLING_BRIEF");
    const businessBrief = [
      `Business Knowledge: Last goal was ${state?.current_goal || 'none'}`,
      ...facts.map(f => `${f.key}: ${JSON.stringify(f.value)}`)
    ].join("\n");

    // 4. CONVERSATIONAL RENDERING (Probabilistic Proposal)
    t("CALLING_LLM");
    const proposedDecision = await generateStaffReply(input.messageText, businessBrief, profile || { business_name: "The Shop" });
    t("LLM_REPLIED:" + proposedDecision.confidence);

    // 5. DETERMINISTIC RULE ENGINE (Operational Authority)
    t("VALIDATING_ACTION");
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

    // 6. DETERMINISTIC POST-PROCESSING (Sanitization & Price Lock)
    t("SANITIZING_REPLY");
    const { sanitizedReply, actionOverride } = sanitizeStaffReply(proposedDecision.response, facts);

    const finalDecision: StaffDecision = {
      response: sanitizedReply,
      customer_need: proposedDecision.customer_need,
      action: actionOverride ? { ...validatedAction, type: actionOverride, urgency: "HIGH" } : validatedAction,
      confidence: proposedDecision.confidence
    };

    // 7. EXECUTION
    t("EXECUTING_DECISION");
    const outcome = await executeStaffDecision(sql, input.tenantId, input.senderPhone, finalDecision, input.correlationId);
    t("EXECUTION_DONE");

    // 8. PERSISTENCE
    t("COMMITTING_EVENT");
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
      causationId: input.eventId,
    });

    t("LOOP_SUCCESS");
    return {
      responseText: finalDecision.response,
      responseType: "conversation",
      delivered: false,
      latencyMs: Date.now() - start,
      correlationId: input.correlationId,
    };

  } catch (err) {
    t("LOOP_FATAL_ERROR:" + String(err));
    console.error("[FATAL_REAL]", err);
    throw err;
  }
}
