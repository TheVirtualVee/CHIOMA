import type { ExecutionContext } from "./state-machine.js";

export interface RuntimeInvariant {
  id: string;
  description: string;
  check: (ctx: ExecutionContext) => boolean;
}

export const RUNTIME_INVARIANTS: RuntimeInvariant[] = [
  {
    id: "INV-001",
    description: "Every message must have a unique idempotency key before leaving INGESTED",
    check: (ctx) => ctx.stage !== "LEDGERED" || ctx.idempotencyKey !== undefined,
  },
  {
    id: "INV-002",
    description: "No side effect may be dispatched before its originating event is committed",
    check: (ctx) =>
      ctx.stage !== "EXECUTED" ||
      (ctx.eventCommitTimestamp !== undefined &&
        ctx.effectDispatchTimestamp !== undefined &&
        ctx.eventCommitTimestamp < ctx.effectDispatchTimestamp),
  },
  {
    id: "INV-003",
    description: "Committed events are immutable — content hash must never change",
    check: (ctx) => {
      if (!ctx.committedEvent) return true;
      return verifyContentHash(ctx.committedEvent.payload, ctx.committedEvent.contentHash);
    },
  },
  {
    id: "INV-004",
    description: "Replay must produce identical committed events from identical ledger inputs",
    check: (ctx) =>
      ctx.isReplay ? ctx.replayedEventHash === ctx.originalEventHash : true,
  },
];

export function validateInvariants(ctx: ExecutionContext): void {
  for (const inv of RUNTIME_INVARIANTS) {
    if (!inv.check(ctx)) {
      throw new Error(`INVARIANT_VIOLATION [${inv.id}]: ${inv.description}`);
    }
  }
}

function verifyContentHash(payload: unknown, expectedHash: string): boolean {
  const { createHash } = require("node:crypto");
  const actual = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return actual === expectedHash;
}
