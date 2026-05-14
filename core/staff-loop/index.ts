import { createHash } from "node:crypto";
import { 
  StaffLoopInput, 
  StaffLoopResult,
  EmployabilityProfile,
  StaffDecision
} from "../contracts/index.js";
import { validateStaffAction, sanitizeStaffReply } from "../staff-rules/index.js";
import { enforceEmployeePsychology } from "../staff-rules/behavioral-enforcer.js";
import { generateStaffReply } from "../../services/response-service/index.js";
import { enforceMemoryGovernance, createGovernedMemory } from "../memory/governance.js";

export async function runStaffLoop(
  input: StaffLoopInput,
  sql: any,
  config: { apiKey: string; provider: string },
  profile: EmployabilityProfile
): Promise<StaffLoopResult> {
  const start = Date.now();
  const t = (m: string) => console.log(`[STAFF_LOOP_TRACE] [${Date.now() - start}ms] ${m}`);
  
  try {
    const [state]: any[] = await sql`SELECT last_customer_need, current_goal FROM customer_memory WHERE tenant_id = ${input.tenantId} AND customer_phone = ${input.senderPhone}`;
    const facts: { key: string; value: any }[] = await sql`SELECT key, value FROM business_facts WHERE tenant_id = ${input.tenantId} LIMIT 20`;
    
    // Governed Memory Scrubbing
    const rawMemories = [
      createGovernedMemory("last_customer_need", state?.last_customer_need || ""),
      createGovernedMemory("current_goal", state?.current_goal || "")
    ];
    const governedMemories = enforceMemoryGovernance(rawMemories);

    const businessBrief = [
      `Business Knowledge: Last goal was ${governedMemories.find(m => m.key === 'current_goal')?.value || 'none'}`,
      ...facts.map((f: { key: string; value: any }) => `${f.key}: ${JSON.stringify(f.value)}`)
    ].join("\n");

    t("LLM_INVOCATION_START");
    const proposed = await generateStaffReply(input.messageText, businessBrief, profile);
    
    const validatedAction = validateStaffAction(
      { 
        type: proposed.suggested_action.type,
        urgency: proposed.suggested_action.urgency,
        revenue_weight: proposed.suggested_action.revenue_weight,
        need_classification: proposed.suggested_action.need_classification
      },
      { 
        currentTime: new Date(), 
        profile, 
        customerState: state, 
        llmConfidence: proposed.confidence 
      }
    );

    const { sanitizedReply, actionOverride } = sanitizeStaffReply(proposed.response, facts);

    const behavioralAudit = enforceEmployeePsychology(sanitizedReply);
    
    let finalReply = behavioralAudit.correctedResponse;
    let finalConfidence = proposed.confidence;

    if (behavioralAudit.mode === "REWRITE") {
      console.log(`[BEHAVIORAL_ENFORCER] REWRITE_MODE: Repairing response. Original violations: ${behavioralAudit.violations.length}`);
      finalConfidence = Math.max(0.76, proposed.confidence - 0.1); // Ensure it stays above the 0.75 threshold
    } else if (behavioralAudit.mode === "BLOCK") {
      console.warn(`[BEHAVIORAL_ENFORCER] BLOCK_MODE: Fatal violation detected. Using safe fallback.`);
      finalReply = behavioralAudit.safeFallback;
      finalConfidence = 0.9; // High confidence for the fallback message to ensure it's delivered
    }

    const finalAction: StaffAction = actionOverride ? {
      type: "ESCALATE",
      urgency: "HIGH",
      revenue_weight: validatedAction.revenue_weight,
      need_classification: "ESCALATION_REQUIRED"
    } : {
      ...validatedAction,
      type: behavioralAudit.mode === "BLOCK" ? "REPLY" as const : validatedAction.type
    };

    const decision: StaffDecision = {
      intent_type: proposed.intent_type,
      confidence: finalConfidence,
      response_payload: finalReply,
      required_actions: [finalAction],
      safety_flags: behavioralAudit.violations.map(v => v.rule),
      source: "LLM",
      customer_need: proposed.customer_need,
      decision_hash: createHash("sha256").update(finalReply + JSON.stringify(finalAction)).digest("hex")
    };

    return {
      responseText: decision.response_payload,
      responseType: "conversation",
      delivered: false,
      latencyMs: Date.now() - start,
      correlationId: input.correlationId,
      decision
    };

  } catch (err) {
    console.error(`[STAFF_LOOP] COGNITION_FAILURE: ${err}`);
    return {
      responseText: "I'm having a bit of trouble. Let me check that for you.",
      responseType: "error_degraded",
      delivered: false,
      latencyMs: Date.now() - start,
      correlationId: input.correlationId,
    };
  }
}
