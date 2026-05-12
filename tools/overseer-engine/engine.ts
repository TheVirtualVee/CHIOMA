/**
 * CHIOMA OVERSEER ENGINE — CORE ENGINE (v1.2 Risk-Aware Evaluator)
 *
 * This is the deterministic enforcement pipeline.
 * It has been evolved into a Risk-Aware Scoped Evaluator.
 */

import { 
  checkRule1NoPartialImplementations,
  checkRule2NoSilentFailure,
  checkRule3EventSourcingGuarantee,
  checkRule4TenantIsolation,
  checkRule5LlmOutputNeverTrusted,
  checkRule6NoDeadCode,
  checkRule7NoArchitecturalDrift,
  checkRule8ObservabilityMandatory,
  checkRule9NoInfiniteLogic,
  checkRule10ProductionComplete,
  checkRule11ContextPropagation,
  checkRule12CommentPurity
} from "./rules.js";
import type {
  Changeset,
  FileChange,
  OverseerDecision,
  PipelineStep,
  StepResult,
  Violation,
  OverseerStatus,
} from "./types.js";

// ---------------------------------------------------------------------------
// STEP EXECUTOR
// ---------------------------------------------------------------------------
function runStep(
  step: PipelineStep,
  fn: () => Violation[]
): StepResult {
  const start = Date.now();
  let violations: Violation[] = [];
  try {
    violations = fn();
  } catch (err) {
    violations = [
      {
        rule: "RULE_10_PRODUCTION_COMPLETE",
        severity: "CRITICAL",
        message: `Overseer internal error during step "${step}": ${err instanceof Error ? err.message : String(err)}`,
        filePath: "(overseer-engine internal)",
        line: null,
        evidence: err instanceof Error ? (err.stack ?? err.message) : String(err),
      },
    ];
  }

  return {
    step,
    passed: violations.every(v => v.severity !== "CRITICAL"),
    violations,
    durationMs: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// PIPELINE STEPS
// ---------------------------------------------------------------------------

function stepParse(changeset: Changeset): Violation[] {
  const violations: Violation[] = [];
  for (const file of changeset.files) {
    if (!file.filePath || typeof file.filePath !== "string") {
      violations.push({
        rule: "RULE_10_PRODUCTION_COMPLETE",
        severity: "CRITICAL",
        message: "File entry is missing a valid filePath string.",
        filePath: "(unknown)",
        line: null,
        evidence: JSON.stringify(file).slice(0, 200),
      });
    }
  }
  return violations;
}

function stepStructuralCheck(files: readonly FileChange[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    if (file.changeType === "deleted") continue;
    const isServiceFile = file.filePath.includes("/services/") && file.filePath.endsWith(".ts");
    if (isServiceFile) {
      const hasRegisterExport = /export\s+(?:function|const|async\s+function)\s+register\w+/.test(file.content);
      const hasDefaultExport = /export\s+default/.test(file.content);
      if (!hasRegisterExport && !hasDefaultExport) {
        violations.push({
          rule: "RULE_7_NO_ARCHITECTURAL_DRIFT",
          severity: "HIGH",
          message: `Service file "${file.filePath}" does not export a register* function.`,
          filePath: file.filePath,
          line: null,
          evidence: "No export function register* found",
          suggestion: "Export a 'register[ServiceName]' function to comply with service boundary contracts.",
        });
      }
    }
  }
  return [
    ...violations,
    ...files.flatMap(f => checkRule12CommentPurity(f))
  ];
}

function stepContractCheck(files: readonly FileChange[]): Violation[] {
  return files.flatMap((f) => [
    ...checkRule3EventSourcingGuarantee(f),
    ...checkRule4TenantIsolation(f),
    ...checkRule5LlmOutputNeverTrusted(f),
    ...checkRule11ContextPropagation(f),
  ]);
}

function stepBehaviorCheck(files: readonly FileChange[]): Violation[] {
  return files.flatMap((f) => [
    ...checkRule1NoPartialImplementations(f),
    ...checkRule2NoSilentFailure(f),
    ...checkRule7NoArchitecturalDrift(f),
  ]);
}

function stepObservabilityCheck(files: readonly FileChange[]): Violation[] {
  return files.flatMap((f) => checkRule8ObservabilityMandatory(f));
}

function stepFailureModeSimulation(files: readonly FileChange[]): Violation[] {
  return files.flatMap((f) => [
    ...checkRule6NoDeadCode(f),
    ...checkRule9NoInfiniteLogic(f),
    ...checkRule10ProductionComplete(f),
  ]);
}

// ---------------------------------------------------------------------------
// MAIN ENGINE
// ---------------------------------------------------------------------------

export function enforce(changeset: Changeset, correlationId: string): OverseerDecision {
  const stepResults: StepResult[] = [];

  stepResults.push(runStep("PARSE", () => stepParse(changeset)));
  if (!stepResults[0].passed) return buildDecision(stepResults, correlationId);

  stepResults.push(runStep("STRUCTURAL_CHECK", () => stepStructuralCheck(changeset.files)));
  stepResults.push(runStep("CONTRACT_CHECK", () => stepContractCheck(changeset.files)));
  stepResults.push(runStep("BEHAVIOR_CHECK", () => stepBehaviorCheck(changeset.files)));
  stepResults.push(runStep("OBSERVABILITY_CHECK", () => stepObservabilityCheck(changeset.files)));
  stepResults.push(runStep("FAILURE_MODE_SIMULATION", () => stepFailureModeSimulation(changeset.files)));

  return buildDecision(stepResults, correlationId);
}

// ---------------------------------------------------------------------------
// RISK EVALUATOR
// ---------------------------------------------------------------------------

function buildDecision(stepResults: StepResult[], correlationId: string): OverseerDecision {
  const allViolations = stepResults.flatMap(s => s.violations);
  
  // Scoring Logic
  let riskScore = 0;
  let criticalCount = 0;
  for (const v of allViolations) {
    if (v.severity === "CRITICAL") {
      riskScore += 100;
      criticalCount++;
    } else if (v.severity === "HIGH") {
      riskScore += 40;
    } else if (v.severity === "MEDIUM") {
      riskScore += 10;
    } else if (v.severity === "LOW") {
      riskScore += 1;
    }
  }

  // Status Determination
  let status: OverseerStatus = "APPROVED";
  if (criticalCount > 0 || riskScore >= 100) {
    status = "REJECTED";
  } else if (riskScore > 0) {
    status = "DEGRADED";
  }

  const reason = status === "APPROVED" 
    ? "All rules passed." 
    : `${allViolations.length} violations detected. Risk score: ${riskScore}.`;

  return {
    status,
    riskScore,
    criticalViolations: criticalCount,
    violations: allViolations,
    reason,
    decidedAt: new Date().toISOString(),
    correlationId,
    stepResults,
  };
}
