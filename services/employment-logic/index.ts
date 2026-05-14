import type { StaffDecision, StaffAction } from "../../core/contracts/index.js";

export async function executeStaffDecision(
  sql: any,
  tenantId: string,
  customerPhone: string,
  decision: StaffDecision,
  correlationId: string
): Promise<{ outcome: string }> {
  for (const action of decision.required_actions) {
    if (action.need_classification === "REVENUE_NOW" || action.need_classification === "REVENUE_SOON") {
      await sql`
        INSERT INTO customer_opportunities (tenant_id, correlation_id, customer_need, urgency, recommended_action, confidence)
        VALUES (${tenantId}, ${correlationId}, ${decision.customer_need}, ${action.urgency}, ${action.type}, ${decision.confidence})
        ON CONFLICT DO NOTHING
      `;
    }

    switch (action.type) {
      case "ESCALATE":
        await sql`
          INSERT INTO owner_notifications (tenant_id, correlation_id, urgency, message_text)
          VALUES (${tenantId}, ${correlationId}, ${action.urgency}, ${decision.response_payload})
        `;
        break;

      case "SCHEDULE_FOLLOWUP":
        await sql`
          INSERT INTO follow_up_queue (tenant_id, correlation_id, status)
          VALUES (${tenantId}, ${correlationId}, 'PENDING')
        `;
        break;
    }
  }

  await updateConversationFlow(sql, tenantId, customerPhone, decision);
  return { outcome: "SUCCESS" };
}

async function updateConversationFlow(
  sql: any,
  tenantId: string,
  customerPhone: string,
  decision: StaffDecision
) {
  const now = new Date().toISOString();
  const primaryAction = decision.required_actions[0] || { type: "REPLY", need_classification: "NO_REVENUE" };
  
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
      ${primaryAction.type}, 
      ${primaryAction.need_classification === 'REVENUE_NOW' ? 'WARM' : 'COLD'},
      ${sql.json([{ customer_need: decision.customer_need, action: primaryAction.type, timestamp: now }])}
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
