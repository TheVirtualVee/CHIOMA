import type postgres from "postgres";
import type { LlmOutput } from "../../core/contracts/index.js";

/**
 * services/revenue-reflex-engine/index.ts
 *
 * Deterministic Action Router for Revenue Signals.
 * Converts "Signal" -> "Outcome in the Real World".
 */

export async function routeAction(
  sql: postgres.Sql,
  tenantId: string,
  correlationId: string,
  signal: LlmOutput
): Promise<{ executedAction: string; notificationSent: boolean }> {
  const action = signal.revenue_classification?.recommended_action || "IGNORE";
  
  // 1. Audit the intended action
  await sql`
    UPDATE revenue_signals 
    SET recommended_action = ${action}, 
        urgency = ${signal.revenue_classification?.urgency || 'LOW'}
    WHERE correlation_id = ${correlationId}
  `;

  // 2. Execute the Reflex
  switch (action) {
    case "ESCALATE_TO_OWNER":
      return await escalateToOwner(sql, tenantId, correlationId, signal);
    
    case "RESPOND_IMMEDIATELY":
      // The sync pipeline already responds immediately.
      return { executedAction: "RESPOND_IMMEDIATELY", notificationSent: false };

    case "SCHEDULE_FOLLOWUP":
      await sql`
        INSERT INTO follow_up_queue (tenant_id, correlation_id, status)
        VALUES (${tenantId}, ${correlationId}, 'PENDING')
      `;
      return { executedAction: "SCHEDULE_FOLLOWUP", notificationSent: false };

    case "IGNORE":
    default:
      return { executedAction: "IGNORE", notificationSent: false };
  }
}

async function escalateToOwner(
  sql: postgres.Sql,
  tenantId: string,
  correlationId: string,
  signal: LlmOutput
): Promise<{ executedAction: string; notificationSent: boolean }> {
  // Placeholder for real owner notification (Email/Telegram/Push)
  // For Phase 1, we commit to an authoritative "Escalation Signal" table.
  
  await sql`
    INSERT INTO escalation_signals (tenant_id, correlation_id, urgency, message_text)
    VALUES (
      ${tenantId}, 
      ${correlationId}, 
      ${signal.revenue_classification?.urgency || 'HIGH'}, 
      ${signal.response}
    )
  `;

  console.log(`[ESCALATION] Tenant ${tenantId} notified for correlation ${correlationId}`);
  
  return { executedAction: "ESCALATE_TO_OWNER", notificationSent: true };
}
