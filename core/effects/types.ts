export type SideEffectType =
  | "SEND_WHATSAPP_MESSAGE"
  | "SEND_EMAIL_NOTIFICATION"
  | "TRIGGER_WEBHOOK"
  | "WRITE_AUDIT_LOG";

export type SideEffectStatus =
  | "PENDING"
  | "IN_FLIGHT"
  | "SUCCEEDED"
  | "FAILED_RETRYABLE"
  | "FAILED_TERMINAL"
  | "DEAD_LETTERED"
  | "COMPENSATED";

export interface SideEffectRecord {
  readonly sideEffectId: string;
  readonly originatingEventId: string;
  readonly idempotencyKey: string;
  readonly effectType: SideEffectType;
  readonly payload: unknown;
  readonly status: SideEffectStatus;
  readonly maxAttempts: number;
  readonly attemptCount: number;
  readonly nextAttemptAt: string | null;
  readonly deadLetterAt: string | null;
  readonly executionReceiptId: string | null;
  readonly tenantId: string;
}

export interface ExecutionReceipt {
  readonly receiptId: string;
  readonly sideEffectId: string;
  readonly attemptNumber: number;
  readonly executedAt: string;
  readonly outcome: "SUCCESS" | "FAILURE";
  readonly externalCorrelationId: string | null;
  readonly responsePayload: unknown;
  readonly durationMs: number;
  readonly workerInstanceId: string;
}

export interface SendWhatsAppPayload {
  phoneNumberId: string;
  recipientPhone: string;
  messageText: string;
  accessToken: string;
}
