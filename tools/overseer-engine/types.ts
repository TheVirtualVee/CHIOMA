/**
 * CHIOMA OVERSEER ENGINE — TYPE CONTRACTS (v1.2 Risk-Aware Scoping)
 *
 * This file defines the complete type surface for the Overseer Engine.
 * It has been evolved from a binary gate into a Risk-Aware Evaluator.
 */

// ---------------------------------------------------------------------------
// RULE IDENTIFIERS & SEVERITY
// ---------------------------------------------------------------------------

export type RuleId =
  | "RULE_1_NO_PARTIAL_IMPLEMENTATIONS"
  | "RULE_2_NO_SILENT_FAILURE"
  | "RULE_3_EVENT_SOURCING_GUARANTEE"
  | "RULE_4_TENANT_ISOLATION_MANDATORY"
  | "RULE_5_LLM_OUTPUT_NEVER_TRUSTED"
  | "RULE_6_NO_DEAD_CODE"
  | "RULE_7_NO_ARCHITECTURAL_DRIFT"
  | "RULE_8_OBSERVABILITY_MANDATORY"
  | "RULE_9_NO_INFINITE_LOGIC"
  | "RULE_10_PRODUCTION_COMPLETE"
  | "RULE_11_CONTEXT_PROPAGATION"
  | "RULE_12_COMMENT_PURITY";

/**
 * RuleSeverity determines how much a violation impacts the final risk score.
 */
export type RuleSeverity = 
  | "CRITICAL" // Breaks correctness, replay, or security. Force REJECTED.
  | "HIGH"     // Breaks observability, trust, or architecture.
  | "MEDIUM"   // Degraded behavior or production risk.
  | "LOW";      // Hygiene or non-critical best practices.

/**
 * RuleScope determines where a rule is applicable.
 */
export type RuleScope = 
  | "CORE"      // core/ commitment-engine/
  | "INFRA"     // infrastructure/
  | "SERVICE"   // services/
  | "CLI"       // cli/ tools/
  | "TEST"      // .test.ts .spec.ts
  | "GLOBAL";   // Applies everywhere

// ---------------------------------------------------------------------------
// VIOLATION — a single detected rule breach
// ---------------------------------------------------------------------------

export type Violation = {
  rule: RuleId;
  severity: RuleSeverity;
  message: string;
  filePath: string;
  line: number | null;
  evidence: string;
  /** Optional suggestion for how to fix the violation automatically or manually */
  suggestion?: string;
};

// ---------------------------------------------------------------------------
// PIPELINE STEP RESULTS — each step produces a typed record
// ---------------------------------------------------------------------------

export type StepResult = {
  step: PipelineStep;
  passed: boolean;
  violations: Violation[];
  durationMs: number;
};

export type PipelineStep =
  | "PARSE"
  | "STRUCTURAL_CHECK"
  | "CONTRACT_CHECK"
  | "BEHAVIOR_CHECK"
  | "OBSERVABILITY_CHECK"
  | "FAILURE_MODE_SIMULATION"
  | "FINAL_DECISION";

// ---------------------------------------------------------------------------
// OVERSEER DECISION — the risk-aware final output
// ---------------------------------------------------------------------------

export type OverseerStatus = "APPROVED" | "DEGRADED" | "REJECTED";

export type OverseerDecision = {
  status: OverseerStatus;
  riskScore: number; // 0 (Low) to 100 (Critical)
  criticalViolations: number;
  violations: Violation[];
  reason: string;
  decidedAt: string;
  correlationId: string;
  stepResults: StepResult[];
};

// ---------------------------------------------------------------------------
// CHANGESET — the input to the engine
// ---------------------------------------------------------------------------

export type FileChange = {
  filePath: string;
  content: string;
  changeType: "added" | "modified" | "deleted";
};

export type Changeset = {
  changesetId: string;
  submittedAt: string;
  submittedBy: string;
  files: FileChange[];
};

// ---------------------------------------------------------------------------
// ENGINE CONTEXT
// ---------------------------------------------------------------------------

export type OverseerContext = {
  changeset: Changeset;
  correlationId: string;
  startedAt: number;
};
