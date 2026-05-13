import type postgres from "postgres";
import type { StaffDecision, StaffAction } from "../../core/contracts/index.js";

/**
 * services/employment-logic/index.ts
 *
 * STAFF DECISION CONSEQUENCES.
 * Executes the business outcome of a staff decision.
 */

export async function executeStaffDecision(
  sql: postgres.Sql,
  tenantId: string,
  customerPhone: string,
  decision: StaffDecision,
  correlationId: string
): Promise<{ outcome: string }> {
  const action = decision.action;

  // 1. Persist Customer Opportunity (formerly Revenue Signals)
  if (action.need_classification === "REVENUE_NOW" || action.need_classification === "REVENUE_SOON") {
    await sql`
      INSERT INTO customer_opportunities (tenant_id, correlation_id, customer_need, urgency, recommended_action, confidence)
      VALUES (${tenantId}, ${correlationId}, ${decision.customer_need}, ${action.urgency}, ${action.type}, ${decision.confidence})
      ON CONFLICT DO NOTHING
    `;
  }

  // 2. Resolve Conversation Flow (formerly State Machine)
  await updateConversationFlow(sql, tenantId, customerPhone, decision);

  // 3. Execute Staff Action
  switch (action.type) {
    case "ESCALATE":
      await sql`
        INSERT INTO owner_notifications (tenant_id, correlation_id, urgency, message_text)
        VALUES (${tenantId}, ${correlationId}, ${action.urgency}, ${decision.response})
      `;
      return { outcome: "NOTIFIED_OWNER" };

    case "SCHEDULE_FOLLOWUP":
      await sql`
        INSERT INTO follow_up_queue (tenant_id, correlation_id, status)
        VALUES (${tenantId}, ${correlationId}, 'PENDING')
      `;
      return { outcome: "FOLLOW_UP_SCHEDULED" };

    case "REPLY":
    case "IGNORE":
    default:
      return { outcome: "REPLIED_AS_STAFF" };
  }
}

async function updateConversationFlow(
  sql: postgres.Sql,
  tenantId: string,
  customerPhone: string,
  decision: StaffDecision
) {
  const now = new Date().toISOString();
  await sql`
    INSERT INTO customer_memory (
      tenant_id, 
      customer_phone, 
      last_customer_need, 
      last_action, 
      opportunity_status,
      interaction_sequence
    )
    VALUES (
      ${tenantId}, 
      ${customerPhone}, 
      ${decision.customer_need}, 
      ${decision.action.type}, 
      ${decision.action.need_classification === 'REVENUE_NOW' ? 'WARM' : 'COLD'},
      ${sql.json([{ customer_need: decision.customer_need, action: decision.action.type, timestamp: now }])}
    )
    ON CONFLICT (tenant_id, customer_phone) DO UPDATE SET
      last_customer_need = EXCLUDED.last_customer_need,
      last_action = EXCLUDED.last_action,
      opportunity_status = CASE 
        WHEN EXCLUDED.opportunity_status = 'WARM' AND customer_memory.opportunity_status = 'COLD' THEN 'WARM'
        ELSE customer_memory.opportunity_status 
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

