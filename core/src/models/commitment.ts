import type { CommitmentSeverity } from "../enums/commitment-severity.js";
import { resolveCommitmentPolicy, type CommitmentPolicyShape } from "../policies/commitment-policy.js";

export type CommitmentOrigin = "explicit" | "inferred";

export type CommitmentStatus =
  | "pending"
  | "in_progress"
  | "escalated"
  | "resolved"
  | "failed"
  | "abandoned";

export type CommitmentType =
  | "booking"
  | "price_check"
  | "follow_up"
  | "escalation"
  | "other";

export const COMMITMENT_TYPES: readonly CommitmentType[] = [
  "booking",
  "price_check",
  "follow_up",
  "escalation",
  "other",
] as const;

export function isCommitmentType(v: string): v is CommitmentType {
  return (COMMITMENT_TYPES as readonly string[]).includes(v);
}

export type CommitmentEscalationMeta = {
  reason?: string;
  ownerContactId?: string;
};

export type CommitmentAuditEntry = {
  at: string;
  action: string;
  detail?: unknown;
};

export type Commitment = {
  id: string;
  origin: CommitmentOrigin;
  type: CommitmentType;
  /** v1.1 — drives validation strictness and escalation defaults */
  severity: CommitmentSeverity;
  ambiguityScore: number;
  confidenceScore: number;
  deadlineIso: string;
  status: CommitmentStatus;
  escalation: CommitmentEscalationMeta;
  auditTrail: CommitmentAuditEntry[];
};

export type CommitmentCandidate = {
  origin: CommitmentOrigin;
  type: CommitmentType;
  /** Defaults to MEDIUM when omitted (v1.1 additive) */
  severity?: CommitmentSeverity;
  ambiguityScore: number;
  confidenceScore: number;
  deadlineIso: string;
  businessSupports: boolean;
  feasibilityConfirmed: boolean;
};

export type CommitmentValidationErrorCode =
  | "CONFIDENCE_TOO_LOW"
  | "AMBIGUITY_TOO_HIGH"
  | "BUSINESS_NOT_SUPPORTED"
  | "FEASIBILITY_NOT_CONFIRMED";

export type CommitmentValidationError = {
  code: CommitmentValidationErrorCode;
  message: string;
};

export type CommitmentValidationResult =
  | { ok: true; value: Commitment }
  | { ok: false; error: CommitmentValidationError };

function newId(): string {
  return `cmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function validateCommitmentCandidate(
  candidate: CommitmentCandidate,
  policyOverrides?: Partial<CommitmentPolicyShape>,
): CommitmentValidationResult {
  const policy = resolveCommitmentPolicy(candidate.severity, policyOverrides);
  if (candidate.confidenceScore < policy.minConfidence) {
    return {
      ok: false,
      error: {
        code: "CONFIDENCE_TOO_LOW",
        message: `confidence ${candidate.confidenceScore} < min ${policy.minConfidence}`,
      },
    };
  }
  if (candidate.ambiguityScore > policy.maxAmbiguity) {
    return {
      ok: false,
      error: {
        code: "AMBIGUITY_TOO_HIGH",
        message: `ambiguity ${candidate.ambiguityScore} > max ${policy.maxAmbiguity}`,
      },
    };
  }
  if (!candidate.businessSupports) {
    return {
      ok: false,
      error: {
        code: "BUSINESS_NOT_SUPPORTED",
        message: "business state does not support this commitment",
      },
    };
  }
  if (!candidate.feasibilityConfirmed) {
    return {
      ok: false,
      error: {
        code: "FEASIBILITY_NOT_CONFIRMED",
        message: "feasibility not confirmed against business rules",
      },
    };
  }
  const severity: CommitmentSeverity = candidate.severity ?? "MEDIUM";
  const now = new Date().toISOString();
  const commitment: Commitment = {
    id: newId(),
    origin: candidate.origin,
    type: candidate.type,
    severity,
    ambiguityScore: candidate.ambiguityScore,
    confidenceScore: candidate.confidenceScore,
    deadlineIso: candidate.deadlineIso,
    status: "pending",
    escalation: {},
    auditTrail: [{ at: now, action: "CREATED", detail: { via: "validation_gate", severity } }],
  };  return { ok: true, value: commitment };
}
