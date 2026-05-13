/** contract: FailureClassification */
export type FailureType = 
  | "CONFIG_INVALID" 
  | "INTENT_UNRESOLVABLE" 
  | "EXECUTION_FAILED" 
  | "GOVERNANCE_BLOCKED"
  | "DB_CONNECTIVITY_FAILED"
  | "DB_SCHEMA_INVALID"
  | "DB_POOL_EXHAUSTED"
  | "DB_LEASE_FAILURE";

export class ChiomaError extends Error {
  constructor(public type: FailureType, message: string) {
    super(`[${type}] ${message}`);
  }
}
