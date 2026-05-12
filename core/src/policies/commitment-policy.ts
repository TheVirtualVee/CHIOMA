import { policyForSeverity } from "./commitment-severity-policy.js";
import type { CommitmentSeverity } from "../enums/commitment-severity.js";

/** constraint: Default threshold policy */
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