export type FailureClass =
  | "TRANSIENT_INFRASTRUCTURE"
  | "RATE_LIMITED"
  | "INVALID_LLM_OUTPUT"
  | "BUSINESS_RULE_VIOLATION"
  | "IDEMPOTENCY_COLLISION"
  | "SCHEMA_DRIFT"
  | "PARTIAL_SIDE_EFFECT"
  | "POISON_MESSAGE"
  | "UNKNOWN_RECOVERABLE"
  | "UNKNOWN_TERMINAL";

export interface ClassifiedFailure {
  failureId: string;
  class: FailureClass;
  isReplayEligible: boolean;
  isEscalationRequired: boolean;
  compensationRequired: boolean;
  quarantineMessage: boolean;
  maxReplayAttempts: number;
  alertLevel: "NONE" | "LOG" | "ALERT" | "PAGE";
}

export type FailureMatrix = Record<
  FailureClass,
  Omit<ClassifiedFailure, "failureId" | "class">
>;

export const FAILURE_MATRIX: FailureMatrix = {
  TRANSIENT_INFRASTRUCTURE: {
    isReplayEligible: true,
    isEscalationRequired: false,
    compensationRequired: false,
    quarantineMessage: false,
    maxReplayAttempts: 5,
    alertLevel: "LOG",
  },
  RATE_LIMITED: {
    isReplayEligible: true,
    isEscalationRequired: false,
    compensationRequired: false,
    quarantineMessage: false,
    maxReplayAttempts: 10,
    alertLevel: "LOG",
  },
  INVALID_LLM_OUTPUT: {
    isReplayEligible: true,
    isEscalationRequired: false,
    compensationRequired: false,
    quarantineMessage: false,
    maxReplayAttempts: 3,
    alertLevel: "ALERT",
  },
  BUSINESS_RULE_VIOLATION: {
    isReplayEligible: false,
    isEscalationRequired: true,
    compensationRequired: false,
    quarantineMessage: false,
    maxReplayAttempts: 0,
    alertLevel: "ALERT",
  },
  IDEMPOTENCY_COLLISION: {
    isReplayEligible: false,
    isEscalationRequired: false,
    compensationRequired: false,
    quarantineMessage: false,
    maxReplayAttempts: 0,
    alertLevel: "LOG",
  },
  SCHEMA_DRIFT: {
    isReplayEligible: false,
    isEscalationRequired: true,
    compensationRequired: false,
    quarantineMessage: true,
    maxReplayAttempts: 0,
    alertLevel: "PAGE",
  },
  PARTIAL_SIDE_EFFECT: {
    isReplayEligible: false,
    isEscalationRequired: true,
    compensationRequired: true,
    quarantineMessage: false,
    maxReplayAttempts: 1,
    alertLevel: "PAGE",
  },
  POISON_MESSAGE: {
    isReplayEligible: false,
    isEscalationRequired: true,
    compensationRequired: false,
    quarantineMessage: true,
    maxReplayAttempts: 0,
    alertLevel: "PAGE",
  },
  UNKNOWN_RECOVERABLE: {
    isReplayEligible: true,
    isEscalationRequired: false,
    compensationRequired: false,
    quarantineMessage: false,
    maxReplayAttempts: 2,
    alertLevel: "ALERT",
  },
  UNKNOWN_TERMINAL: {
    isReplayEligible: false,
    isEscalationRequired: true,
    compensationRequired: false,
    quarantineMessage: true,
    maxReplayAttempts: 0,
    alertLevel: "PAGE",
  },
};

export function classify(error: unknown): ClassifiedFailure {
  const message = error instanceof Error ? error.message : String(error);
  const failureId = `fail_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  let failureClass: FailureClass;

  if (message.includes("RATE_LIMIT") || message.includes("429")) {
    failureClass = "RATE_LIMITED";
  } else if (message.includes("TIMEOUT") || message.includes("ECONNRESET") || message.includes("ECONNREFUSED")) {
    failureClass = "TRANSIENT_INFRASTRUCTURE";
  } else if (message.includes("INVALID_LLM_OUTPUT") || message.includes("ZodError")) {
    failureClass = "INVALID_LLM_OUTPUT";
  } else if (message.includes("BUSINESS_RULE_VIOLATION")) {
    failureClass = "BUSINESS_RULE_VIOLATION";
  } else if (message.includes("IDEMPOTENCY_COLLISION") || message.includes("duplicate key")) {
    failureClass = "IDEMPOTENCY_COLLISION";
  } else if (message.includes("SCHEMA_DRIFT")) {
    failureClass = "SCHEMA_DRIFT";
  } else if (message.includes("PARTIAL_SIDE_EFFECT")) {
    failureClass = "PARTIAL_SIDE_EFFECT";
  } else {
    failureClass = "UNKNOWN_RECOVERABLE";
  }

  return {
    failureId,
    class: failureClass,
    ...FAILURE_MATRIX[failureClass],
  };
}

export type OperationMode = "FULL" | "RULES_ONLY" | "INGESTION_ONLY" | "MAINTENANCE";
