export type ExecutionStage =
  | "INGESTED"
  | "LEDGERED"
  | "PROPOSED"
  | "VALIDATED"
  | "COMMITTED"
  | "EXECUTED"
  | "FINALIZED"
  | "FAILED";

export type MutationWriter =
  | "INGESTION_LAYER"
  | "LEDGER"
  | "LLM"
  | "RULES_ENGINE"
  | "COMPILER"
  | "EVENT_STORE"
  | "EFFECT_WORKER";

export type MutationTarget =
  | "LEDGER"
  | "PROPOSAL_BUFFER"
  | "EXECUTION_PLAN"
  | "EVENT_LOG"
  | "EFFECT_QUEUE"
  | "RECEIPT_STORE";

export interface MutationAuthority {
  stage: ExecutionStage;
  allowedWriters: MutationWriter[];
  allowedTargets: MutationTarget[];
  forbiddenOps: string[];
}

export const MUTATION_CONTRACT: Record<ExecutionStage, MutationAuthority> = {
  INGESTED: {
    stage: "INGESTED",
    allowedWriters: ["INGESTION_LAYER"],
    allowedTargets: ["LEDGER"],
    forbiddenOps: ["MUTATE_BUSINESS_STATE", "ENQUEUE_EFFECT", "EMIT_EVENT"],
  },
  LEDGERED: {
    stage: "LEDGERED",
    allowedWriters: ["LEDGER"],
    allowedTargets: ["PROPOSAL_BUFFER"],
    forbiddenOps: ["MUTATE_BUSINESS_STATE", "ENQUEUE_EFFECT", "EMIT_EVENT", "COMMIT_PLAN"],
  },
  PROPOSED: {
    stage: "PROPOSED",
    allowedWriters: ["LLM"],
    allowedTargets: ["PROPOSAL_BUFFER"],
    forbiddenOps: [
      "MUTATE_BUSINESS_STATE",
      "ENQUEUE_EFFECT",
      "EMIT_EVENT",
      "COMMIT_PLAN",
      "DIRECT_DB_WRITE",
      "CALL_EXTERNAL_API",
    ],
  },
  VALIDATED: {
    stage: "VALIDATED",
    allowedWriters: ["RULES_ENGINE", "COMPILER"],
    allowedTargets: ["EXECUTION_PLAN"],
    forbiddenOps: ["MUTATE_BUSINESS_STATE", "ENQUEUE_EFFECT", "CALL_EXTERNAL_API"],
  },
  COMMITTED: {
    stage: "COMMITTED",
    allowedWriters: ["EVENT_STORE"],
    allowedTargets: ["EVENT_LOG"],
    forbiddenOps: ["MUTATE_PROPOSAL", "BYPASS_RULES"],
  },
  EXECUTED: {
    stage: "EXECUTED",
    allowedWriters: ["EFFECT_WORKER"],
    allowedTargets: ["EFFECT_QUEUE", "RECEIPT_STORE"],
    forbiddenOps: ["MUTATE_COMMITTED_EVENT", "BYPASS_IDEMPOTENCY"],
  },
  FINALIZED: {
    stage: "FINALIZED",
    allowedWriters: [],
    allowedTargets: [],
    forbiddenOps: ["*"],
  },
  FAILED: {
    stage: "FAILED",
    allowedWriters: ["RULES_ENGINE", "COMPILER", "EFFECT_WORKER"],
    allowedTargets: ["LEDGER"],
    forbiddenOps: ["SILENT_DISCARD", "RETRY_WITHOUT_CLASSIFICATION"],
  },
};

export const LEGAL_TRANSITIONS: Record<ExecutionStage, ExecutionStage[]> = {
  INGESTED: ["LEDGERED", "FAILED"],
  LEDGERED: ["PROPOSED", "FAILED"],
  PROPOSED: ["VALIDATED", "FAILED"],
  VALIDATED: ["COMMITTED", "FAILED"],
  COMMITTED: ["EXECUTED", "FAILED"],
  EXECUTED: ["FINALIZED", "FAILED"],
  FINALIZED: [],
  FAILED: [],
};
