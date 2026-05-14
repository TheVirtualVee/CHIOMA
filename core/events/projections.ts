import { initialState, type ChiomaEvent, type ProjectedState } from "./types.js";
import { verifyContentHash, loadEventsAfter } from "./store.js";
import { exhaustiveCheck } from "../kernel/exhaustive.js";

export type { ProjectedState } from "./types.js";
export { initialState } from "./types.js";

export interface SnapshotProvider {
  find(sql: any, aggregateId: string, upToSequence?: number): Promise<{
    upToSequence: number;
    state: ProjectedState;
  } | null>;
}

export function applyEvent(state: ProjectedState, event: ChiomaEvent): ProjectedState {
  switch (event.type) {
    case "MESSAGE_RECEIVED":
      return {
        ...state,
        lastMessageAt: event.payload.receivedAt,
        pendingMessageId: event.payload.whatsappMessageId,
      };

    case "PROPOSAL_GENERATED":
      return {
        ...state,
        lastProposalId: event.payload.proposalId,
        lastProposalConfidence: event.payload.confidenceScore,
      };

    case "PROPOSAL_REJECTED":
      return {
        ...state,
        failureCount: state.failureCount + 1,
      };

    case "ACTION_PLAN_COMPILED":
      return {
        ...state,
        currentPlanId: event.payload.planId,
        planCompiledAt: event.payload.compiledAt,
      };

    case "SIDE_EFFECT_DISPATCHED":
      return {
        ...state,
        sideEffectIds: [...state.sideEffectIds, event.payload.sideEffectId],
      };

    case "SIDE_EFFECT_CONFIRMED":
      return state;

    case "SIDE_EFFECT_FAILED":
      return {
        ...state,
        failureCount: state.failureCount + 1,
      };

    case "LIFECYCLE_FINALIZED":
      return {
        ...state,
        finalizedAt: event.occurredAt,
      };

    case "REPLAY_INITIATED":
      return state;

    case "SYSTEM_FAILURE":
      return {
        ...state,
        failureCount: state.failureCount + 1,
      };

    default:
      return exhaustiveCheck(event);
  }
}

export async function replayAggregate(
  sql: any,
  aggregateId: string,
  snapshotProvider?: SnapshotProvider,
  targetSequence?: number
): Promise<ProjectedState> {
  const snapshot = snapshotProvider
    ? await snapshotProvider.find(sql, aggregateId, targetSequence)
    : null;

  const afterSequence = snapshot?.upToSequence ?? 0;
  const events = await loadEventsAfter(sql, aggregateId, afterSequence, targetSequence);

  let state = snapshot?.state ?? initialState(aggregateId);

  for (const event of events) {
    if (!verifyContentHash(event)) {
      throw new Error(`REPLAY_INTEGRITY_ERROR: Hash mismatch on event ${event.eventId}`);
    }
    state = applyEvent(state, event);
  }

  return state;
}
