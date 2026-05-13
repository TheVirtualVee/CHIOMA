import type postgres from "postgres";
import type { 
  EmployabilityProfile, 
  CustomerMemory, 
  EmployabilityDecision, 
  LlmOutput 
} from "../../core/contracts/index.js";

/**
 * services/employability-engine/index.ts
 *
 * Converts raw AI intelligence into "financially accountable employee" behavior.
 * Enforces business rules, tone consistency, and revenue gravity.
 */

export async function processEmployability(
  sql: postgres.Sql,
  tenantId: string,
  customerPhone: string,
  signal: LlmOutput
): Promise<EmployabilityDecision> {
  
  // 1. Fetch Context (Profile + Memory)
  const [profile] = await sql<EmployabilityProfile[]>`
    SELECT tone_profile, response_aggressiveness, follow_up_policy, availability_mode, conversion_bias, owner_preference_memory
    FROM employer_profiles WHERE tenant_id = ${tenantId}
  `;

  const [memory] = await sql<CustomerMemory[]>`
    SELECT last_intent, unresolved_count, conversion_status, metadata
    FROM customer_memory WHERE tenant_id = ${tenantId} AND customer_phone = ${customerPhone}
  `;

  // 2. Apply Rule 2: Revenue Gravity
  let urgency = 1;
  let shouldNotifyOwner = false;
  let revenueWeight = signal.confidence * (signal.is_revenue_intent ? 1.5 : 1.0);

  if (signal.is_revenue_intent) {
    urgency = signal.revenue_classification?.urgency === "URGENT" ? 5 : 3;
    if (urgency >= 4 || profile?.response_aggressiveness === "high") {
      shouldNotifyOwner = true;
    }
  }

  // 3. Apply Rule 4: Tone Lock
  const tone = profile?.tone_profile || "friendly-shopkeeper";

  // 4. Decision Construction
  const decision: EmployabilityDecision = {
    response_type: signal.revenue_classification?.recommended_action === "ESCALATE_TO_OWNER" ? "escalate" : "reply",
    tone,
    urgency_level: urgency,
    should_notify_owner: shouldNotifyOwner,
    revenue_weight: revenueWeight,
    next_action: signal.revenue_classification?.recommended_action || "RESPOND_IMMEDIATELY"
  };

  // 5. Rule 1: Never Leave Idle (Update Memory)
  await updateMemory(sql, tenantId, customerPhone, signal);

  // 6. Audit the Trace
  await sql`
    INSERT INTO employability_traces (tenant_id, correlation_id, decision_type, tone_applied, revenue_weight, urgency_level, next_action_logic)
    VALUES (
      ${tenantId}, 
      'TBD', -- Correlation set by runtime
      ${decision.response_type}, 
      ${decision.tone}, 
      ${decision.revenue_weight}, 
      ${decision.urgency_level}, 
      ${decision.next_action}
    ) ON CONFLICT DO NOTHING
  `;

  return decision;
}

async function updateMemory(
  sql: postgres.Sql,
  tenantId: string,
  customerPhone: string,
  signal: LlmOutput
) {
  await sql`
    INSERT INTO customer_memory (tenant_id, customer_phone, last_intent, unresolved_count)
    VALUES (${tenantId}, ${customerPhone}, ${signal.intent}, 0)
    ON CONFLICT (tenant_id, customer_phone) DO UPDATE SET
      last_intent = EXCLUDED.last_intent,
      unresolved_count = customer_memory.unresolved_count + 1,
      updated_at = CURRENT_TIMESTAMP
  `;
}
