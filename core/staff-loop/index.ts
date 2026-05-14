import { createHash } from "node:crypto";
import { 
  StaffLoopInput, 
  StaffLoopResult,
  EmployabilityProfile,
  StaffDecision
} from "../contracts/index.js";
import { validateStaffAction, sanitizeStaffReply } from "../staff-rules/index.js";
import { generateStaffReply } from "../../services/response-service/index.js";

export async function runStaffLoop(
  input: StaffLoopInput,
  sql: any,
  config: { apiKey: string; provider: string },
  profile: EmployabilityProfile
): Promise<StaffLoopResult> {
  const start = Date.now();
  
  try {
    const [state]: any[] = await sql`SELECT last_customer_need, current_goal FROM customer_memory WHERE tenant_id = ${input.tenantId} AND customer_phone = ${input.senderPhone}`;
    const facts: { key: string; value: any }[] = await sql`SELECT key, value FROM business_facts WHERE tenant_id = ${input.tenantId} LIMIT 20`;
    
    const businessBrief = [
      `Business Knowledge: Last goal was ${state?.current_goal || 'none'}`,
      ...facts.map((f: { key: string; value: any }) => `${f.key}: ${JSON.stringify(f.value)}`)
    ].join("\n");

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

    const decision: StaffDecision = {
      intent_type: "UNKNOWN",
      confidence: proposed.confidence,
      response_payload: sanitizedReply,
      required_actions: [actionOverride ? { ...validatedAction, type: actionOverride, urgency: "HIGH" } : validatedAction],
      safety_flags: [],
      source: "LLM",
      customer_need: proposed.customer_need,
      decision_hash: createHash("sha256").update(sanitizedReply + JSON.stringify(validatedAction)).digest("hex")
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
    return {
      responseText: "I'm having a bit of trouble. Let me check that for you.",
      responseType: "error_degraded",
      delivered: false,
      latencyMs: Date.now() - start,
      correlationId: input.correlationId,
    };
  }
}
