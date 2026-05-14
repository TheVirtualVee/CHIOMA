import { randomUUID } from "node:crypto";
import { ExecutionTimeline, TimelineEvent, ExecutionState, TraceContext } from "../contracts/telemetry.js";

export class TelemetryManager {
  private timeline: ExecutionTimeline;
  private start: number;

  constructor(messageId: string, traceId: string) {
    this.start = Date.now();
    this.timeline = {
      traceId,
      messageId,
      startedAt: this.start,
      stages: [],
      finalState: "IN_PROGRESS",
    };
  }

  record(stage: string, metadata?: Record<string, any>) {
    const now = Date.now();
    const event: TimelineEvent = {
      stage,
      timestamp: now,
      elapsedMs: now - this.start,
      metadata,
    };
    this.timeline.stages.push(event);
    
    // Structured log for external observability (Vercel/Datadog/etc)
    console.log(`[TELEMETRY] [${event.elapsedMs}ms] ${stage}${metadata ? ' ' + JSON.stringify(metadata) : ''}`);
  }

  complete(state: ExecutionState) {
    this.timeline.finalState = state;
    this.record("FINALIZATION_COMPLETED", { finalState: state });
  }

  getTimeline(): ExecutionTimeline {
    return this.timeline;
  }
}

export function createTraceContext(workerId: string): TraceContext {
  return {
    traceId: `trc_${randomUUID()}`,
    executionId: `exec_${randomUUID()}`,
    workerId,
  };
}
