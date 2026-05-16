export interface BaseEvent {
  readonly eventId: string;
  readonly tenantId: string;
  readonly aggregateId: string;
  readonly aggregateType: "CONVERSATION" | "EMPLOYER" | "SYSTEM";
  readonly sequenceNumber: number;
  readonly causationId: string;
  readonly correlationId: string;
  readonly ledgerEntryId: string;
  readonly occurredAt: string;
  readonly schemaVersion: number;
  readonly contentHash: string;
}

export interface MessageReceivedEvent extends BaseEvent {
  type: "MESSAGE_RECEIVED";
  payload: {
    channel: "whatsapp" | "sms" | "web" | "simulation" | "telegram";
    from: string;
    text: string;
    waMessageId?: string;
  };
}

export interface ProposalGeneratedEvent extends BaseEvent {
  type: "PROPOSAL_GENERATED";
  payload: {
    proposalId: string;
    modelVersion: string;
    promptVersion: string;
    inferenceLatencyMs: number;
    confidenceScore: number;
    performanceScore: number;
    performanceGrade: string;
    behavioralFlags: string[];
    lawViolations: string[];
    operationalFlags: string[];
    proposal: unknown;
  };
}

export interface ProposalRejectedEvent extends BaseEvent {
  type: "PROPOSAL_REJECTED";
  payload: {
    proposalId: string;
    reasons: string[];
  };
}

export interface ActionPlanCompiledEvent extends BaseEvent {
  type: "ACTION_PLAN_COMPILED";
  payload: {
    planId: string;
    rulesApplied: string[];
    overridesApplied: string[];
    compiledAt: string;
  };
}

export interface SideEffectDispatchedEvent extends BaseEvent {
  type: "SIDE_EFFECT_DISPATCHED";
  payload: {
    sideEffectId: string;
    effectType: string;
    targetId: string;
  };
}

export interface SideEffectConfirmedEvent extends BaseEvent {
  type: "SIDE_EFFECT_CONFIRMED";
  payload: {
    sideEffectId: string;
    receiptId: string;
    externalCorrelationId: string | null;
    durationMs: number;
  };
}

export interface SideEffectFailedEvent extends BaseEvent {
  type: "SIDE_EFFECT_FAILED";
  payload: {
    sideEffectId: string;
    attemptNumber: number;
    errorMessage: string;
    isRetryable: boolean;
  };
}

export interface LifecycleFinalizedEvent extends BaseEvent {
  type: "LIFECYCLE_FINALIZED";
  payload: {
    totalDurationMs: number;
    stagesCompleted: string[];
    receiptCount: number;
  };
}

export interface ReplayInitiatedEvent extends BaseEvent {
  type: "REPLAY_INITIATED";
  payload: {
    originalCorrelationId: string;
    replayReason: string;
    fromSequence: number;
  };
}

export interface SystemFailureEvent extends BaseEvent {
  type: "SYSTEM_FAILURE";
  payload: {
    failureClass: string;
    errorMessage: string;
    stage: string;
    isRecoverable: boolean;
  };
}

export interface ProjectedState {
  aggregateId: string;
  lastMessageAt: string | null;
  pendingMessageId: string | null;
  currentPlanId: string | null;
  planCompiledAt: string | null;
  lastProposalId: string | null;
  lastProposalConfidence: number | null;
  sideEffectIds: string[];
  finalizedAt: string | null;
  failureCount: number;
}

export function initialState(aggregateId: string): ProjectedState {
  return {
    aggregateId,
    lastMessageAt: null,
    pendingMessageId: null,
    currentPlanId: null,
    planCompiledAt: null,
    lastProposalId: null,
    lastProposalConfidence: null,
    sideEffectIds: [],
    finalizedAt: null,
    failureCount: 0,
  };
}

export type ChiomaEvent =
  | MessageReceivedEvent
  | ProposalGeneratedEvent
  | ProposalRejectedEvent
  | ActionPlanCompiledEvent
  | SideEffectDispatchedEvent
  | SideEffectConfirmedEvent
  | SideEffectFailedEvent
  | LifecycleFinalizedEvent
  | ReplayInitiatedEvent
  | SystemFailureEvent;
