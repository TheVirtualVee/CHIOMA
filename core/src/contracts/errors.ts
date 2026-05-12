/** contract: FailureClassification */
export type FailureType = "CONFIG_INVALID" | "INTENT_UNRESOLVABLE" | "EXECUTION_FAILED" | "GOVERNANCE_BLOCKED";

export class ChiomaError extends Error {
  constructor(public type: FailureType, message: string) {
    super(`[${type}] ${message}`);
  }
}
