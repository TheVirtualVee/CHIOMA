import type { ExecutionStage } from "./execution-contract.js";
import { LEGAL_TRANSITIONS } from "./execution-contract.js";
import { exhaustiveCheck } from "./exhaustive.js";

export interface ExecutionContext {
  stage: ExecutionStage;
  idempotencyKey: string;
  ledgerEntryId?: string;
  proposal?: unknown;
  contextSnapshot?: unknown;
  plan?: unknown;
  committedEventId?: string;
  sideEffectIds?: string[];
  receipts?: unknown[];
  eventCommitTimestamp?: number;
  effectDispatchTimestamp?: number;
  committedEvent?: { contentHash: string; payload: unknown };
  isReplay?: boolean;
  replayedEventHash?: string;
  originalEventHash?: string;
  failure?: import("../failures/classification.js").ClassifiedFailure;
}

export type MessageLifecycle =
  | { stage: "INGESTED"; idempotencyKey: string; ledgered: false; committed: false; finalized: false }
  | { stage: "LEDGERED"; idempotencyKey: string; ledgerEntryId: string; ledgered: true; committed: false; finalized: false }
  | { stage: "PROPOSED"; idempotencyKey: string; ledgerEntryId: string; proposalId: string; ledgered: true; committed: false; finalized: false }
  | { stage: "VALIDATED"; idempotencyKey: string; ledgerEntryId: string; proposalId: string; planId: string; ledgered: true; committed: false; finalized: false }
  | { stage: "COMMITTED"; idempotencyKey: string; ledgerEntryId: string; planId: string; committedEventId: string; ledgered: true; committed: true; finalized: false }
  | { stage: "EXECUTED"; idempotencyKey: string; ledgerEntryId: string; committedEventId: string; sideEffectIds: string[]; ledgered: true; committed: true; finalized: false }
  | { stage: "FINALIZED"; idempotencyKey: string; ledgerEntryId: string; committedEventId: string; receiptIds: string[]; ledgered: true; committed: true; finalized: true }
  | { stage: "FAILED"; idempotencyKey: string; failureId: string; ledgered: true; committed: false; finalized: false };

export function assertLegalTransition(from: ExecutionStage, to: ExecutionStage): void {
  const allowed = LEGAL_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new Error(`ILLEGAL_TRANSITION: ${from} -> ${to}. Allowed: [${allowed.join(", ")}]`);
  }
}

export function handleStage(lifecycle: MessageLifecycle): ExecutionStage {
  switch (lifecycle.stage) {
    case "INGESTED": return lifecycle.stage;
    case "LEDGERED": return lifecycle.stage;
    case "PROPOSED": return lifecycle.stage;
    case "VALIDATED": return lifecycle.stage;
    case "COMMITTED": return lifecycle.stage;
    case "EXECUTED": return lifecycle.stage;
    case "FINALIZED": return lifecycle.stage;
    case "FAILED": return lifecycle.stage;
    default: return exhaustiveCheck(lifecycle);
  }
}
