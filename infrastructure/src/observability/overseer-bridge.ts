import { type ExecutionIntent } from "@chioma/core";

/** contract: OverseerRuntime */
export const overseer = {
  validate(intent: ExecutionIntent, input: string): { ok: boolean; reason?: string } {
    // constraint: minimal runtime validation for CEM integration
    if (intent === "UNCLASSIFIED") return { ok: false, reason: "No executable intent detected" };
    if (input.length > 4000) return { ok: false, reason: "Input exceeds maximum length" };
    return { ok: true };
  }
};
