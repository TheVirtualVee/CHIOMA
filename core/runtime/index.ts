import type postgres from "postgres";
import { 
  SyncPipelineInput, 
  SyncPipelineResult 
} from "../contracts/index.js";
import { processOnboardingStep } from "../../services/onboarding-engine/index.js";
import { generateResponse } from "../../services/llm-orchestrator/index.js";
import { commitEvent } from "../../infrastructure/database/index.js";
import { routeAction } from "../../services/revenue-reflex-engine/index.js";

/**
 * core/runtime/index.ts
 *
 * The single execution brain of CHIOMA.
 * Orchestrates onboarding, context, AI decision, and persistence.
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

    // 2. Business Context Retrieval
    const facts = await sql`SELECT key, value FROM business_facts WHERE tenant_id = ${input.tenantId} LIMIT 20`;
    const context = facts.map(f => `${f.key}: ${JSON.stringify(f.value)}`).join("\n");

    // 3. AI Response Generation
    const aiOutput = await generateResponse(input.messageText, context, config);

    // 4. Persistence & Revenue Capture
    await commitEvent(sql, {
      id: `evt_${Date.now()}`,
      type: "RESPONSE_SENT",
      payload: { 
        text: aiOutput.response, 
        intent: aiOutput.intent,
        is_revenue: aiOutput.is_revenue_intent,
        confidence: aiOutput.confidence
      },
      tenantId: input.tenantId,
      correlationId: input.correlationId,
    });

    if (aiOutput.is_revenue_intent) {
      await sql`
        INSERT INTO revenue_signals (tenant_id, correlation_id, intent, confidence, message_text)
        VALUES (${input.tenantId}, ${input.correlationId}, ${aiOutput.intent}, ${aiOutput.confidence}, ${input.messageText})
      `;

      // Trigger the Reflex Engine Action Router
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
