export type ExecutionState = "COMPLETED" | "FAILED" | "REPLAYED" | "QUARANTINED" | "IN_PROGRESS" | "FOUNDER_COMMAND_DISPATCHED";

export interface TimelineEvent {
  stage: string;
  timestamp: number;
  elapsedMs: number;
  metadata?: Record<string, any>;
}

export interface TraceContext {
  traceId: string;
  executionId: string;
  decisionId?: string;
  replayId?: string;
  workerId: string;
  leaseToken?: string;
}

export interface ExecutionTimeline {
  traceId: string;
  messageId: string;
  startedAt: number;
  stages: TimelineEvent[];
  finalState: ExecutionState;
}
