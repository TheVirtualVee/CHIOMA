import { policyForSeverity } from "./commitment-severity-policy.js";
import type { CommitmentSeverity } from "../enums/commitment-severity.js";

/** Backward-compatible default = MEDIUM thresholds (v1.0 behavior). */
export const DEFAULT_COMMITMENT_POLICY = policyForSeverity("MEDIUM");

export type CommitmentPolicyShape = {
  minConfidence: number;
  maxAmbiguity: number;
};

export function resolveCommitmentPolicy(
  severity: CommitmentSeverity | undefined,
  overrides?: Partial<CommitmentPolicyShape>,
): CommitmentPolicyShape {
  const base = policyForSeverity(severity ?? "MEDIUM");
  return { ...base, ...overrides };
}