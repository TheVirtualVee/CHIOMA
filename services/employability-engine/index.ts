import type postgres from "postgres";
import type { LlmOutput, StaffAction } from "../../core/contracts/index.js";

/**
 * services/employability-engine/index.ts
 *
 * The Single Behavioral Consequence Module.
 * Ensures CHIOMA behaves like a financially accountable employee.
 */

export async function executeStaffDecision(
  sql: postgres.Sql,
  tenantId: string,
  customerPhone: string,
  decision: LlmOutput
): Promise<{ outcome: string }> {
  const action = decision.action;

  // 1. Persist Employee Attention (Revenue Signals)
  if (action.intent_classification === "REVENUE_NOW" || action.intent_classification === "REVENUE_SOON") {
    await sql`
      INSERT INTO revenue_signals (tenant_id, correlation_id, intent, urgency, recommended_action, confidence)
      VALUES (${tenantId}, 'TBD', ${decision.intent}, ${action.urgency}, ${action.type}, ${decision.confidence})
      ON CONFLICT DO NOTHING
    `;
  }

  // 2. Resolve Conversation State (BCL)
  await updateConversationState(sql, tenantId, customerPhone, decision);

  // 3. Execute Downstream Consequence
  switch (action.type) {
    case "ESCALATE":
      await sql`
        INSERT INTO escalation_signals (tenant_id, correlation_id, urgency, message_text)
        VALUES (${tenantId}, 'TBD', ${action.urgency}, ${decision.response})
      `;
      return { outcome: "ESCALATED_TO_OWNER" };

    case "SCHEDULE_FOLLOWUP":
      await sql`
        INSERT INTO follow_up_queue (tenant_id, correlation_id, status)
        VALUES (${tenantId}, 'TBD', 'PENDING')
      `;
      return { outcome: "FOLLOW_UP_SCHEDULED" };

    case "REPLY":
    case "IGNORE":
    default:
      return { outcome: "REPLIED_AS_STAFF" };
  }
}

async function updateConversationState(
  sql: postgres.Sql,
  tenantId: string,
  customerPhone: string,
  decision: LlmOutput
) {
  const now = new Date().toISOString();
  await sql`
    INSERT INTO customer_memory (
      tenant_id, 
      customer_phone, 
      last_intent, 
      last_action, 
      revenue_status,
      interaction_sequence
    )
    VALUES (
      ${tenantId}, 
      ${customerPhone}, 
      ${decision.intent}, 
      ${decision.action.type}, 
      ${decision.action.intent_classification === 'REVENUE_NOW' ? 'WARM' : 'COLD'},
      ${sql.json([{ intent: decision.intent, action: decision.action.type, timestamp: now }])}
    )
    ON CONFLICT (tenant_id, customer_phone) DO UPDATE SET
      last_intent = EXCLUDED.last_intent,
      last_action = EXCLUDED.last_action,
      revenue_status = CASE 
        WHEN EXCLUDED.revenue_status = 'WARM' AND customer_memory.revenue_status = 'COLD' THEN 'WARM'
        ELSE customer_memory.revenue_status 
      END,
      interaction_sequence = (
        SELECT jsonb_agg(elem)
        FROM (
          SELECT elem FROM jsonb_array_elements(customer_memory.interaction_sequence || EXCLUDED.interaction_sequence) AS elem
          ORDER BY (elem->>'timestamp') DESC
          LIMIT 5
        ) AS sub
      ),
      updated_at = CURRENT_TIMESTAMP
  `;
}
