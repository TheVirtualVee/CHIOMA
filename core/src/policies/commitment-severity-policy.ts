import type { CommitmentSeverity } from "../enums/commitment-severity.js";

export function policyForSeverity(severity: CommitmentSeverity): {
  minConfidence: number;
  maxAmbiguity: number;
} {
  switch (severity) {
    case "LOW":
      return { minConfidence: 0.6, maxAmbiguity: 0.78 };
    case "MEDIUM":
      return { minConfidence: 0.75, maxAmbiguity: 0.6 };
    case "HIGH":
      return { minConfidence: 0.84, maxAmbiguity: 0.45 };
    case "CRITICAL":
      return { minConfidence: 0.92, maxAmbiguity: 0.28 };
    default: {
      const _exhaustive: never = severity;
      return _exhaustive;
    }
  }
}
