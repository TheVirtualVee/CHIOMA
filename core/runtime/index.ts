import type postgres from "postgres";
import { 
  SyncPipelineInput, 
  SyncPipelineResult,
  EmployabilityProfile
} from "../contracts/index.js";
import { processOnboardingStep } from "../../services/onboarding-engine/index.js";
import { generateResponse } from "../../services/llm-orchestrator/index.js";
import { commitEvent } from "../../infrastructure/database/index.js";
import { routeAction } from "../../services/revenue-reflex-engine/index.js";
import { processEmployability } from "../../services/employability-engine/index.js";

/**
 * core/runtime/index.ts
 *
 * The single execution brain of CHIOMA.
 * Incorporates the "Employability Layer" to ensure staff-like accountability.
 */

export async function runSyncPipeline(
  input: SyncPipelineInput,
  sql: postgres.Sql,
  config: { apiKey: string; provider: string }
): Promise<SyncPipelineResult> {
  const start = Date.now();

  try {
    // 1. Onboarding Gate
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

    // 2. Employability Profile & Context Retrieval
    const [profile] = await sql<EmployabilityProfile[]>`
      SELECT tone_profile, response_aggressiveness, follow_up_policy, availability_mode, conversion_bias 
      FROM employer_profiles WHERE tenant_id = ${input.tenantId}
    `;
    const facts = await sql`SELECT key, value FROM business_facts WHERE tenant_id = ${input.tenantId} LIMIT 20`;
    const context = facts.map(f => `${f.key}: ${JSON.stringify(f.value)}`).join("\n");

    // 3. AI Response Generation (Tone-Locked)
    const aiOutput = await generateResponse(input.messageText, context, { 
      ...config, 
      tone: profile?.tone_profile 
    });

    // 4. Employability Decision Engine (Mandatory Behavioral Rules)
    const decision = await processEmployability(sql, input.tenantId, input.senderPhone, aiOutput);

    // 5. Persistence & Revenue Trace
    await commitEvent(sql, {
      id: `evt_${Date.now()}`,
      type: "RESPONSE_SENT",
      payload: { 
        text: aiOutput.response, 
        intent: aiOutput.intent,
        is_revenue: aiOutput.is_revenue_intent,
        employability: decision
      },
      tenantId: input.tenantId,
      correlationId: input.correlationId,
    });

    // 6. Action Reflex Loop
    if (aiOutput.is_revenue_intent || decision.response_type === "escalate") {
      await sql`
        INSERT INTO revenue_signals (tenant_id, correlation_id, intent, confidence, message_text, urgency, recommended_action)
        VALUES (${input.tenantId}, ${input.correlationId}, ${aiOutput.intent}, ${aiOutput.confidence}, ${input.messageText}, ${decision.urgency_level}, ${decision.next_action})
        ON CONFLICT (correlation_id) DO NOTHING
      `;
      await routeAction(sql, input.tenantId, input.correlationId, aiOutput);
    }

    return {
      responseText: aiOutput.response,
      responseType: "conversation",
      delivered: false,
      latencyMs: Date.now() - start,
      correlationId: input.correlationId,
    };

  } catch (err) {
    console.error("PIPELINE_CRASH", err);
    return {
      responseText: "System error. Please try again shortly.",
      responseType: "error_degraded",
      delivered: false,
      latencyMs: Date.now() - start,
      correlationId: input.correlationId,
    };
  }
}
