import {
  EVENT_TYPES,
  createFollowupEvent,
  type CommitmentCandidate,
  type EventBus,
  type LlmStructuredOutput,
  isCommitmentSeverity,
  isCommitmentType,
  validateCommitmentCandidate,
} from "@chioma/core";
import { createConsoleLogger, createSafeHandler, metrics } from "@chioma/infrastructure";

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

/** contract: CommitmentEngine */
export function registerCommitmentEngine(bus: EventBus): void {
  const logger = createConsoleLogger("commitment-engine");

  bus.subscribe(
    EVENT_TYPES.MEMORY_UPDATED,
    createSafeHandler(
      async (event) => {
        const payload = event.payload as { kind?: string; structured?: LlmStructuredOutput } | null;
        if (payload?.kind !== "LLM_COMPLETED" || !payload.structured) return;

        const { tenantId, correlationId, id: causationId } = event;
        const proposals = Array.isArray(payload.structured.proposed_commitments)
          ? payload.structured.proposed_commitments
          : [];

        for (const raw of proposals) {
          const candidate = parseCommitmentCandidate(raw);
          if (!candidate) {
            logger.warn("COMMITMENT_PARSE_FAILED", { correlationId, tenantId, causationId });
            continue;
          }
          
          const result = validateCommitmentCandidate(candidate);
          if (!result.ok) {
            logger.warn("COMMITMENT_REJECTED", { correlationId, tenantId, causationId, code: result.error.code });
            metrics.emit("commitment_rejected", { correlationId, tenantId, causationId, code: result.error.code, service: "commitment-engine" });
            await bus.publish(createFollowupEvent(EVENT_TYPES.EXECUTION_FAILED, { reason: "COMMITMENT_VALIDATION_FAILURE", code: result.error.code }, event));
            continue;
          }
          
          metrics.emit("commitment_validated", { correlationId, tenantId, causationId, service: "commitment-engine" });
          
          await bus.publish(
            createFollowupEvent(
              EVENT_TYPES.COMMITMENT_CREATED,
              { commitment: result.value },
              event
            )
          );

          await bus.publish(createFollowupEvent(EVENT_TYPES.EXECUTION_COMPLETED, { action: "COMMITMENT_CREATED", commitmentId: result.value.id }, event));
        }
      },
      { service: "commitment-engine", operation: "PROCESS_COMMITMENTS", logger }
    )
  );
}
