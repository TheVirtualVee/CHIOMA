import {
  EVENT_TYPES,
  type CommitmentCandidate,
  type EventBus,
  type LlmStructuredOutput,
  isCommitmentSeverity,
  isCommitmentType,
  validateCommitmentCandidate,
} from "@chioma/core";
import { createConsoleLogger, devEvent } from "@chioma/infrastructure";

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function parseCommitmentCandidate(raw: unknown): CommitmentCandidate | null {
  if (!isRecord(raw)) return null;
  const origin = raw.origin === "explicit" || raw.origin === "inferred" ? raw.origin : null;
  const type = typeof raw.type === "string" && isCommitmentType(raw.type) ? raw.type : null;
  const ambiguityScore = typeof raw.ambiguityScore === "number" ? raw.ambiguityScore : NaN;
  const confidenceScore = typeof raw.confidenceScore === "number" ? raw.confidenceScore : NaN;
  const deadlineIso = typeof raw.deadlineIso === "string" ? raw.deadlineIso : "";
  const businessSupports = raw.businessSupports === true;
  const feasibilityConfirmed = raw.feasibilityConfirmed === true;
  const severity =
    typeof raw.severity === "string" && isCommitmentSeverity(raw.severity) ? raw.severity : undefined;
  if (!origin || !type || !Number.isFinite(ambiguityScore) || !Number.isFinite(confidenceScore)) return null;
  if (!deadlineIso) return null;
  return {
    origin,
    type,
    severity,
    ambiguityScore,
    confidenceScore,
    deadlineIso,
    businessSupports,
    feasibilityConfirmed,
  };
}

export function registerCommitmentEngine(bus: EventBus): void {
  const log = createConsoleLogger("commitment-engine");
  bus.subscribe(EVENT_TYPES.MEMORY_UPDATED, async (e) => {
    const p = e.payload as { kind?: string; structured?: LlmStructuredOutput } | null;
    if (p?.kind !== "LLM_COMPLETED" || !p.structured) return;

    const proposals = Array.isArray(p.structured.proposed_commitments)
      ? p.structured.proposed_commitments
      : [];

    for (const raw of proposals) {
      const candidate = parseCommitmentCandidate(raw);
      if (!candidate) {
        log.warn("COMMITMENT_PARSE_FAILED", { correlationId: e.correlationId });
        continue;
      }
      const result = validateCommitmentCandidate(candidate);
      if (!result.ok) {
        log.warn("COMMITMENT_REJECTED", { correlationId: e.correlationId, code: result.error.code });
        continue;
      }
      log.info("COMMITMENT_CREATED", { correlationId: e.correlationId, commitmentId: result.value.id });
      await bus.publish(
        devEvent(
          `cmt_${result.value.id}`,
          EVENT_TYPES.COMMITMENT_CREATED,
          { commitment: result.value },
          e.correlationId,
          e.id,
          e.tenantId,
        ),
      );
    }
  });
}
