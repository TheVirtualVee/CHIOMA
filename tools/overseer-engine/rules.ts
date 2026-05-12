/**
 * CHIOMA OVERSEER ENGINE — RULE CHECKERS (v1.2 Risk-Aware Scoping)
 *
 * Each function implements exactly one rule with context-aware severity.
 */

import type { FileChange, RuleId, Violation, RuleSeverity, RuleScope } from "./types.js";

// ---------------------------------------------------------------------------
// CONTEXT HELPERS
// ---------------------------------------------------------------------------

function getRuleScope(filePath: string): RuleScope {
  const path = filePath.toLowerCase().replace(/\\/g, "/");
  if (path.includes(".test.") || path.includes(".spec.") || path.includes("test/")) return "TEST";
  if (path.includes("core/")) return "CORE";
  if (path.includes("infrastructure/")) return "INFRA";
  if (path.includes("services/")) return "SERVICE";
  if (path.includes("cli/") || path.includes("tools/")) return "CLI";
  return "GLOBAL";
}

function createViolation(params: {
  rule: RuleId;
  file: FileChange;
  message: string;
  evidence: string;
  line?: number | null;
  baseSeverity: RuleSeverity;
  suggestion?: string;
}): Violation {
  const scope = getRuleScope(params.file.filePath);
  let severity = params.baseSeverity;

  // Context-Aware Severity Adjustment
  if (scope === "TEST") {
    severity = "LOW"; // Tests are always low-risk
  } else if (scope === "CORE" && severity !== "CRITICAL") {
    // Elevate severity for core logic
    if (severity === "HIGH") severity = "CRITICAL";
    if (severity === "MEDIUM") severity = "HIGH";
  } else if (scope === "CLI" && (params.rule === "RULE_10_PRODUCTION_COMPLETE" || params.rule === "RULE_8_OBSERVABILITY_MANDATORY")) {
    severity = "LOW"; // Relax logging/observability for CLI tools
  }

  return {
    rule: params.rule,
    severity,
    message: params.message,
    filePath: params.file.filePath,
    line: params.line ?? null,
    evidence: params.evidence,
    suggestion: params.suggestion,
  };
}

// ---------------------------------------------------------------------------
// RULE 1 — NO PARTIAL IMPLEMENTATIONS
// ---------------------------------------------------------------------------
const STUB_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\bTODO\b/g, label: "TODO" },
  { pattern: /\bFIXME\b/g, label: "FIXME" },
  { pattern: /\bmock\b/gi, label: "mock" },
  { pattern: /\bdummy\b/gi, label: "dummy" },
  { pattern: /\bplaceholder\b/gi, label: "placeholder" },
  { pattern: /\bstub\b/gi, label: "stub" },
  { pattern: /pseudo[-\s]?code/gi, label: "pseudo-code" },
  { pattern: /simulate/gi, label: "simulate" },
  { pattern: /example\s+implementation/gi, label: "example implementation" },
  { pattern: /throw\s+new\s+Error\s*\(\s*['"`]not\s+implemented/gi, label: "not-implemented-throw" },
];

export function checkRule1NoPartialImplementations(file: FileChange): Violation[] {
  if (file.changeType === "deleted") return [];
  const violations: Violation[] = [];
  const lines = file.content.split("\n");

  for (const { pattern, label } of STUB_PATTERNS) {
    const freshPattern = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = freshPattern.exec(file.content)) !== null) {
      const lineIndex = file.content.slice(0, match.index).split("\n").length;
      violations.push(createViolation({
        rule: "RULE_1_NO_PARTIAL_IMPLEMENTATIONS",
        file,
        line: lineIndex,
        message: `Partial implementation token "${label}" detected.`,
        evidence: lines[lineIndex - 1]?.trim() ?? "",
        baseSeverity: "CRITICAL",
        suggestion: "Remove the stub/TODO and provide a full production implementation.",
      }));
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// RULE 2 — NO SILENT FAILURE
// ---------------------------------------------------------------------------
const SILENT_FAILURE_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /catch\s*\([^)]*\)\s*\{\s*console\.(log|warn|error|info)\s*\([^;]*\)\s*;?\s*\}/g, label: "catch block with only console.log" },
  { pattern: /catch\s*\([^)]*\)\s*\{\s*\}/g, label: "empty catch block" },
  { pattern: /catch\s*\([^)]*\)\s*\{\s*\/\/[^\n]*\n\s*\}/g, label: "catch block with only a comment" },
  { pattern: /\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/g, label: ".catch(() => {})" },
  { pattern: /(?<!\bawait\b\s)(?<!\bvoid\b\s)\b\w+\s*\([^)]*\)\s*\.then\s*\(/g, label: "unhandled floating promise chain" },
];

export function checkRule2NoSilentFailure(file: FileChange): Violation[] {
  if (file.changeType === "deleted") return [];
  const violations: Violation[] = [];
  const lines = file.content.split("\n");

  for (const { pattern, label } of SILENT_FAILURE_PATTERNS) {
    const freshPattern = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = freshPattern.exec(file.content)) !== null) {
      const lineIndex = file.content.slice(0, match.index).split("\n").length;
      violations.push(createViolation({
        rule: "RULE_2_NO_SILENT_FAILURE",
        file,
        line: lineIndex,
        message: `Silent failure pattern: ${label}. Exceptions must be escalated or handled with visibility.`,
        evidence: lines[lineIndex - 1]?.trim() ?? "",
        baseSeverity: "CRITICAL",
        suggestion: "Rethrow the error, escalate to ReliabilityEngine, or use a safeHandler.",
      }));
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// RULE 3 — EVENT-SOURCING GUARANTEE
// ---------------------------------------------------------------------------
const EVENT_PUBLISH_PATTERN = /bus\.publish\s*\(|\.emit\s*\(/;
const REQUIRED_EVENT_FIELDS = ["tenantId", "correlationId", "causationId"];

export function checkRule3EventSourcingGuarantee(file: FileChange): Violation[] {
  if (file.changeType === "deleted") return [];
  if (!new RegExp(EVENT_PUBLISH_PATTERN.source, EVENT_PUBLISH_PATTERN.flags).test(file.content)) return [];

  const violations: Violation[] = [];
  for (const field of REQUIRED_EVENT_FIELDS) {
    if (!file.content.includes(field)) {
      violations.push(createViolation({
        rule: "RULE_3_EVENT_SOURCING_GUARANTEE",
        file,
        message: `Event-publishing file is missing mandatory field "${field}".`,
        evidence: `bus.publish() or emit() detected but "${field}" absent from file`,
        baseSeverity: "CRITICAL",
        suggestion: `Add ${field} to the event object being published.`,
      }));
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// RULE 4 — TENANT ISOLATION IS MANDATORY
// ---------------------------------------------------------------------------
const DB_OPERATION_PATTERNS = [/\.find\s*\(/g, /\.findOne\s*\(/g, /\.findAll\s*\(/g, /\.query\s*\(/g, /\.select\s*\(/g, /\.where\s*\(/g, /\.update\s*\(/g, /\.delete\s*\(/g, /\.insert\s*\(/g, /\.upsert\s*\(/g, /supabase\s*\.\s*from\s*\(/g, /db\s*\.\s*from\s*\(/g, /collection\s*\.\s*find\s*\(/g];

export function checkRule4TenantIsolation(file: FileChange): Violation[] {
  if (file.changeType === "deleted") return [];
  const violations: Violation[] = [];
  const lines = file.content.split("\n");

  for (const dbPattern of DB_OPERATION_PATTERNS) {
    const fresh = new RegExp(dbPattern.source, dbPattern.flags);
    let match: RegExpExecArray | null;
    while ((match = fresh.exec(file.content)) !== null) {
      const matchStart = match.index;
      const context = file.content.slice(Math.max(0, matchStart - 100), Math.min(file.content.length, matchStart + 400));
      if (!context.includes("tenantId")) {
        const lineIndex = file.content.slice(0, matchStart).split("\n").length;
        violations.push(createViolation({
          rule: "RULE_4_TENANT_ISOLATION_MANDATORY",
          file,
          line: lineIndex,
          message: `Data operation "${match[0].trim()}" detected without tenantId scoping.`,
          evidence: lines[lineIndex - 1]?.trim() ?? "",
          baseSeverity: "CRITICAL",
          suggestion: "Add 'tenantId' to the query filter or surrounding execution context.",
        }));
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// RULE 5 — LLM OUTPUT IS NEVER TRUSTED
// ---------------------------------------------------------------------------
const LLM_OUTPUT_USAGE_PATTERNS = [/llm\./i, /openai\./i, /anthropic\./i, /provider\.complete/i, /JSON\.parse\s*\([^)]*response/i, /JSON\.parse\s*\([^)]*output/i, /JSON\.parse\s*\([^)]*result/i, /JSON\.parse\s*\([^)]*llm/i];
const VALIDATION_EVIDENCE_PATTERNS = [/\.parse\s*\(/, /\.safeParse\s*\(/, /validateSchema\s*\(/, /zodSchema\s*\./, /z\s*\.\s*object\s*\(/, /validateLLMOutput\s*\(/];

export function checkRule5LlmOutputNeverTrusted(file: FileChange): Violation[] {
  if (file.changeType === "deleted" || file.filePath.endsWith("index.ts")) return [];
  if (!LLM_OUTPUT_USAGE_PATTERNS.some(p => p.test(file.content))) return [];

  if (!VALIDATION_EVIDENCE_PATTERNS.some(p => p.test(file.content))) {
    return [createViolation({
      rule: "RULE_5_LLM_OUTPUT_NEVER_TRUSTED",
      file,
      message: "File consumes LLM output but no schema validation (zod .parse() or equivalent) was detected.",
      evidence: "LLM consumption detected; no .parse() / validateSchema() found",
      baseSeverity: "CRITICAL",
      suggestion: "Pass raw LLM output through a Zod schema before using it in business logic.",
    })];
  }
  return [];
}

// ---------------------------------------------------------------------------
// RULE 6 — NO DEAD CODE
// ---------------------------------------------------------------------------
const DEAD_CODE_PATTERNS = [
  { pattern: /\bif\s*\(\s*false\s*\)\s*\{/g, label: "if (false) { — unreachable block" },
  { pattern: /\bwhile\s*\(\s*false\s*\)\s*\{/g, label: "while (false) { — unreachable loop" },
  { pattern: /\/\/\s*@ts-ignore\s*\n[^\n]*unreachable/gi, label: "@ts-ignore + unreachable comment" },
];

export function checkRule6NoDeadCode(file: FileChange): Violation[] {
  if (file.changeType === "deleted") return [];
  const violations: Violation[] = [];
  const lines = file.content.split("\n");

  for (const { pattern, label } of DEAD_CODE_PATTERNS) {
    const fresh = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = fresh.exec(file.content)) !== null) {
      const lineIndex = file.content.slice(0, match.index).split("\n").length;
      violations.push(createViolation({
        rule: "RULE_6_NO_DEAD_CODE",
        file,
        line: lineIndex,
        message: `Dead code: ${label}.`,
        evidence: lines[lineIndex - 1]?.trim() ?? "",
        baseSeverity: "HIGH",
        suggestion: "Remove unreachable code or fix the conditional logic.",
      }));
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// RULE 7 — NO ARCHITECTURAL DRIFT
// ---------------------------------------------------------------------------
const CROSS_SERVICE_IMPORT_PATTERN = /from\s+['"]\.\.\/(?:\.\.\/)*services\/([^/'"]+)\/(?!index)/g;
const DIRECT_DB_MUTATION_PATTERNS = [
  { pattern: /supabase\s*\.\s*from\s*\(['"]\w+['"]\)\s*\.\s*(insert|update|delete|upsert)\s*\(/g, label: "Direct Supabase mutation" },
  { pattern: /prisma\s*\.\s*\w+\s*\.\s*(create|update|delete|upsert)\s*\(/g, label: "Direct Prisma mutation" },
];

export function checkRule7NoArchitecturalDrift(file: FileChange): Violation[] {
  if (file.changeType === "deleted") return [];
  const violations: Violation[] = [];
  const lines = file.content.split("\n");

  const freshImport = new RegExp(CROSS_SERVICE_IMPORT_PATTERN.source, CROSS_SERVICE_IMPORT_PATTERN.flags);
  let match: RegExpExecArray | null;
  while ((match = freshImport.exec(file.content)) !== null) {
    const lineIndex = file.content.slice(0, match.index).split("\n").length;
    violations.push(createViolation({
      rule: "RULE_7_NO_ARCHITECTURAL_DRIFT",
      file,
      line: lineIndex,
      message: `Cross-service import detected: "${match[0].trim()}".`,
      evidence: lines[lineIndex - 1]?.trim() ?? "",
      baseSeverity: "CRITICAL",
      suggestion: "Use @chioma/core contracts or the event bus for cross-service communication.",
    }));
  }

  for (const { pattern, label } of DIRECT_DB_MUTATION_PATTERNS) {
    if (file.filePath.includes("repository") || file.filePath.includes("store") || file.filePath.includes("database")) continue;
    const fresh = new RegExp(pattern.source, pattern.flags);
    while ((match = fresh.exec(file.content)) !== null) {
      const lineIndex = file.content.slice(0, match.index).split("\n").length;
      violations.push(createViolation({
        rule: "RULE_7_NO_ARCHITECTURAL_DRIFT",
        file,
        line: lineIndex,
        message: `${label} outside repository layer.`,
        evidence: lines[lineIndex - 1]?.trim() ?? "",
        baseSeverity: "HIGH",
        suggestion: "Move this data operation into a Repository or Store class.",
      }));
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// RULE 8 — OBSERVABILITY IS MANDATORY
// ---------------------------------------------------------------------------
const SERVICE_REG_PATTERNS = [/register\w+\s*\(/, /createSafeHandler\s*\(/, /bus\.subscribe\s*\(/, /app\.(post|get)\s*\(/, /router\.(post|get)\s*\(/];
const OBS_SIGNALS = ["logger", "correlationId", "tenantId", "metrics"];

export function checkRule8ObservabilityMandatory(file: FileChange): Violation[] {
  if (file.changeType === "deleted") return [];
  if (!SERVICE_REG_PATTERNS.some(p => p.test(file.content))) return [];

  const violations: Violation[] = [];
  for (const field of OBS_SIGNALS) {
    if (!file.content.includes(field)) {
      violations.push(createViolation({
        rule: "RULE_8_OBSERVABILITY_MANDATORY",
        file,
        message: `Service file missing observability signal: "${field}".`,
        evidence: `Service registration detected but "${field}" absent from file`,
        baseSeverity: "HIGH",
        suggestion: `Inject and use '${field}' to ensure full auditability of this service.`,
      }));
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// RULE 9 — NO INFINITE LOGIC
// ---------------------------------------------------------------------------
const INFINITE_PATTERNS = [
  { pattern: /\bwhile\s*\(\s*true\s*\)\s*\{(?![^}]*break)/g, label: "while (true) without break" },
  { pattern: /setInterval\s*\([^,]+,\s*0\s*\)/g, label: "setInterval with 0ms delay" },
  { pattern: /\.retry\s*\([^)]*\)\s*(?!\.[^.]+maxAttempts)/g, label: "retry() without maxAttempts" },
];

export function checkRule9NoInfiniteLogic(file: FileChange): Violation[] {
  if (file.changeType === "deleted") return [];
  const violations: Violation[] = [];
  const lines = file.content.split("\n");

  for (const { pattern, label } of INFINITE_PATTERNS) {
    const fresh = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = fresh.exec(file.content)) !== null) {
      const lineIndex = file.content.slice(0, match.index).split("\n").length;
      violations.push(createViolation({
        rule: "RULE_9_NO_INFINITE_LOGIC",
        file,
        line: lineIndex,
        message: `Potential infinite logic: ${label}.`,
        evidence: lines[lineIndex - 1]?.trim() ?? "",
        baseSeverity: "CRITICAL",
        suggestion: "Add a termination condition or a maximum attempt ceiling.",
      }));
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// RULE 10 — CODE MUST BE PRODUCTION COMPLETE
// ---------------------------------------------------------------------------
const PROD_INCOMPLETE_PATTERNS = [
  { pattern: /process\.exit\s*\(\s*[^01]\s*\)/g, label: "uncontrolled process.exit()" },
  { pattern: /console\.(log|warn|error|info|debug)\s*\(/g, label: "raw console.* call" },
  { pattern: /Math\.random\s*\(\s*\)/g, label: "non-deterministic Math.random()" },
  { pattern: /new\s+Date\s*\(\s*\)(?!\s*\.toISOString)/g, label: "unserialized new Date()" },
];

export function checkRule10ProductionComplete(file: FileChange): Violation[] {
  if (file.changeType === "deleted") return [];
  const violations: Violation[] = [];
  const lines = file.content.split("\n");

  for (const { pattern, label } of PROD_INCOMPLETE_PATTERNS) {
    const fresh = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = fresh.exec(file.content)) !== null) {
      const lineIndex = file.content.slice(0, match.index).split("\n").length;
      violations.push(createViolation({
        rule: "RULE_10_PRODUCTION_COMPLETE",
        file,
        line: lineIndex,
        message: `Production incompleteness: ${label}.`,
        evidence: lines[lineIndex - 1]?.trim() ?? "",
        baseSeverity: "MEDIUM",
        suggestion: label.includes("console") ? "Use ChiomaLogger instead." : "Use DeterministicIdFactory or ISO timestamps.",
      }));
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// RULE 11 — CONTEXT PROPAGATION
// ---------------------------------------------------------------------------
const CONTEXT_TYPES = ["ServiceContext", "ExecutionContext", "tenantId"];

export function checkRule11ContextPropagation(file: FileChange): Violation[] {
  if (file.changeType === "deleted") return [];
  const scope = getRuleScope(file.filePath);
  if (scope === "TEST" || scope === "CLI") return [];

  const isBusinessLogic = file.filePath.includes("services/") || file.filePath.includes("infrastructure/src/");
  if (!isBusinessLogic) return [];

  const hasServiceDef = /register\w+\s*\(|create\w+Handler\s*\(/.test(file.content);
  if (!hasServiceDef) return [];

  const violations: Violation[] = [];
  const lines = file.content.split("\n");
  const funcPattern = /function\s+\w+\s*\([^)]*\)\s*\{/g;
  let match: RegExpExecArray | null;
  
  while ((match = funcPattern.exec(file.content)) !== null) {
    const signature = match[0];
    if (!CONTEXT_TYPES.some(t => signature.includes(t)) && signature.length > 30) {
      const lineIndex = file.content.slice(0, match.index).split("\n").length;
      violations.push(createViolation({
        rule: "RULE_11_CONTEXT_PROPAGATION",
        file,
        line: lineIndex,
        message: "Function missing mandatory context (ServiceContext/tenantId).",
        evidence: signature.trim(),
        baseSeverity: "HIGH",
        suggestion: "Add 'ctx: ServiceContext' as the first argument to this function.",
      }));
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// RULE 12 — COMMENT PURITY RULE
// ---------------------------------------------------------------------------
const ALLOWED_COMMENT_PREFIXES = ["contract:", "constraint:", "side-effect:"];

export function checkRule12CommentPurity(file: FileChange): Violation[] {
  if (file.changeType === "deleted") return [];
  
  const scope = getRuleScope(file.filePath);
  // Rule 12 is ALLOWED in tests, README, EDGES_LOG, and specific scripts
  if (scope === "TEST" || file.filePath.endsWith(".md") || file.filePath.includes("EDGES_LOG") || file.filePath.includes("scripts/")) {
    return [];
  }

  const violations: Violation[] = [];
  const lines = file.content.split("\n");
  
  // Find all comments (// or /* */)
  const commentPattern = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
  let match: RegExpExecArray | null;

  while ((match = commentPattern.exec(file.content)) !== null) {
    const rawComment = match[0];
    const cleanComment = rawComment.replace(/\/\/\s*|\/\*|\*\/|\*/g, "").trim();
    
    if (!cleanComment) continue; // Empty comments are noise but handled by Rule 6/10 if needed

    const isAllowed = ALLOWED_COMMENT_PREFIXES.some(p => cleanComment.toLowerCase().startsWith(p));
    
    // Violation if not allowed AND (sentence-style or long or describes logic)
    const words = cleanComment.split(/\s+/).filter(w => w.length > 0);
    const isLong = words.length > 10;
    const isExplanatory = /[A-Z].*\./.test(cleanComment); // Heuristic: starts with capital, ends with period

    if (!isAllowed && (isLong || isExplanatory)) {
      const lineIndex = file.content.slice(0, match.index).split("\n").length;
      violations.push(createViolation({
        rule: "RULE_12_COMMENT_PURITY",
        file,
        line: lineIndex,
        message: "Forbidden explanatory comment detected. Production code must be self-evident.",
        evidence: cleanComment.slice(0, 100),
        baseSeverity: "HIGH",
        suggestion: "Remove the explanatory narrative. Use code structure to convey intent. Only 'contract:', 'constraint:', or 'side-effect:' markers are allowed.",
      }));
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// RULE REGISTRY
// ---------------------------------------------------------------------------
export type RuleChecker = (file: FileChange) => Violation[];

export const ALL_RULE_CHECKERS: ReadonlyArray<{ ruleId: RuleId; checker: RuleChecker }> = [
  { ruleId: "RULE_1_NO_PARTIAL_IMPLEMENTATIONS", checker: checkRule1NoPartialImplementations },
  { ruleId: "RULE_2_NO_SILENT_FAILURE", checker: checkRule2NoSilentFailure },
  { ruleId: "RULE_3_EVENT_SOURCING_GUARANTEE", checker: checkRule3EventSourcingGuarantee },
  { ruleId: "RULE_4_TENANT_ISOLATION_MANDATORY", checker: checkRule4TenantIsolation },
  { ruleId: "RULE_5_LLM_OUTPUT_NEVER_TRUSTED", checker: checkRule5LlmOutputNeverTrusted },
  { ruleId: "RULE_6_NO_DEAD_CODE", checker: checkRule6NoDeadCode },
  { ruleId: "RULE_7_NO_ARCHITECTURAL_DRIFT", checker: checkRule7NoArchitecturalDrift },
  { ruleId: "RULE_8_OBSERVABILITY_MANDATORY", checker: checkRule8ObservabilityMandatory },
  { ruleId: "RULE_9_NO_INFINITE_LOGIC", checker: checkRule9NoInfiniteLogic },
  { ruleId: "RULE_10_PRODUCTION_COMPLETE", checker: checkRule10ProductionComplete },
  { ruleId: "RULE_11_CONTEXT_PROPAGATION", checker: checkRule11ContextPropagation },
  { ruleId: "RULE_12_COMMENT_PURITY", checker: checkRule12CommentPurity },
];
