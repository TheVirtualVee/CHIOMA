export type CommitmentSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export const COMMITMENT_SEVERITIES: readonly CommitmentSeverity[] = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const;

export function isCommitmentSeverity(v: string): v is CommitmentSeverity {
  return (COMMITMENT_SEVERITIES as readonly string[]).includes(v);
}
