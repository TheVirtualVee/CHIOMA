import type postgres from "postgres";
import { 
  SyncPipelineInput, 
  SyncPipelineResult,
  EmployabilityProfile
} from "../contracts/index.js";
import { processOnboardingStep } from "../../services/onboarding-engine/index.js";
import { generateStaffResponse } from "../../services/llm-orchestrator/index.js";
import { commitEvent } from "../../infrastructure/database/index.js";
import { executeStaffDecision } from "../../services/employability-engine/index.js";

/**
 * core/runtime/index.ts
 *
 * THE CONVERSATIONAL EMPLOYMENT LOOP.
 * 1. Understand intent
 * 2. Check employability state
 * 3. Decide action
 * 4. Respond like staff
 * 5. Persist state
 */

export async function runSyncPipeline(
  input: SyncPipelineInput,
  sql: postgres.Sql,
  config: { apiKey: string; provider: string }
): Promise<SyncPipelineResult> {
  const start = Date.now();

  try {
    // 1. Check Onboarding State (Chat-only onboarding contract)
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

    // 2. Fetch Employee Profile (The single personalization source)
    const [profile] = await sql<EmployabilityProfile[]>`
      SELECT business_name, tone_profile, response_style, escalation_contact 
      FROM employer_profiles WHERE tenant_id = ${input.tenantId}
    `;

    // 3. Context Retrieval (Knowledge & Memory)
    const [state] = await sql`SELECT last_intent, current_goal FROM customer_memory WHERE tenant_id = ${input.tenantId} AND customer_phone = ${input.senderPhone}`;
    const facts = await sql`SELECT key, value FROM business_facts WHERE tenant_id = ${input.tenantId} LIMIT 20`;
    const context = [
      `Memory: Last goal was ${state?.current_goal || 'none'}`,
      ...facts.map(f => `${f.key}: ${JSON.stringify(f.value)}`)
    ].join("\n");

    // 4. Staff Response Generation
    const staffOutput = await generateStaffResponse(input.messageText, context, profile || { business_name: "The Shop" });

    // 5. Execute Behavioral Consequence (Action & State Transition)
    const outcome = await executeStaffDecision(sql, input.tenantId, input.senderPhone, staffOutput);

    // 6. Persistence (Audit Trace)
    await commitEvent(sql, {
      id: crypto.randomUUID(),
      type: "STAFF_ACTION_TAKEN",
      payload: { 
        text: staffOutput.response, 
        action: staffOutput.action,
        outcome: outcome.outcome
      },
      tenantId: input.tenantId,
      correlationId: input.correlationId,
    });

    return {
      responseText: staffOutput.response,
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
