import type { ClassifiedFailure } from "./classification.js";

export interface CompensationAction {
  compensationId: string;
  originatingFailureId: string;
  actionType: "MARK_DEAD_LETTERED" | "NOTIFY_OPERATOR" | "REVERSE_SIDE_EFFECT" | "QUARANTINE_MESSAGE";
  payload: unknown;
  executedAt: string | null;
  outcome: "PENDING" | "SUCCEEDED" | "FAILED";
}

export async function compensate(
  sql: any,
  failure: ClassifiedFailure,
  context: { messageId: string; tenantId: string; sideEffectIds?: string[] }
): Promise<CompensationAction[]> {
  const actions: CompensationAction[] = [];
  const now = new Date().toISOString();

  if (failure.quarantineMessage) {
    await sql`
      UPDATE message_ledger
      SET status = 'QUARANTINED',
          last_error = ${`[${failure.class}] ${failure.failureId}`},
          updated_at = NOW()
      WHERE message_id = ${context.messageId}
    `;
    actions.push({
      compensationId: `comp_${Date.now()}`,
      originatingFailureId: failure.failureId,
      actionType: "QUARANTINE_MESSAGE",
      payload: { messageId: context.messageId },
      executedAt: now,
      outcome: "SUCCEEDED",
    });
  }

  if (failure.isEscalationRequired) {
    await sql`
      INSERT INTO owner_notifications (tenant_id, correlation_id, urgency, message_text)
      VALUES (${context.tenantId}, ${failure.failureId}, 'URGENT', ${`System failure [${failure.class}]: requires operator review.`})
    `;
    actions.push({
      compensationId: `comp_${Date.now()}_esc`,
      originatingFailureId: failure.failureId,
      actionType: "NOTIFY_OPERATOR",
      payload: { failureClass: failure.class },
      executedAt: now,
      outcome: "SUCCEEDED",
    });
  }

  return actions;
}
