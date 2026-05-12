import { z } from "zod";
// ExecutionIntent re-exported for consumers of this module
export type { ExecutionIntent } from "./execution-mapper.js";

/** contract: ECB_Schema */
export const ECBSchema = z.object({
  version: z.string(),
  intents: z.array(z.object({
    id: z.string(),
    priority: z.number(),
    patterns: z.array(z.string()),
    deprecated: z.boolean().default(false),
  })),
  resolutionPolicy: z.object({
    tieBreakRule: z.enum(["hash", "recency"]),
    memoryAlignmentWeight: z.number(),
  }),
  config: z.object({
    priorityOverrides: z.record(z.string(), z.number()).default({}),
    escalationThreshold: z.number().default(0.5),
  }),
  failureModes: z.array(z.string()).default([
    "CONFIG_INVALID",
    "INTENT_UNRESOLVABLE",
    "GOVERNANCE_BLOCKED",
    "EXECUTION_FAILED"
  ]),
});

export type ECB = z.infer<typeof ECBSchema>;

/** contract: ECB_Loader */
export class ECBLoader {
  private static instance: ECB | null = null;

  static load(bundle: unknown): void {
    if (this.instance) {
      throw new Error("GOVERNANCE_BLOCKED: ECB is immutable and already loaded for this deployment");
    }
    const validated = ECBSchema.parse(bundle);
    this.instance = deepFreeze(validated);
  }

  static get(): ECB {
    if (!this.instance) {
      throw new Error("CONFIG_INVALID: No Execution Contract Bundle loaded");
    }
    return this.instance;
  }

  /** Reset singleton — test teardown only. Allows fresh load between tests. */
  static reset(): void {
    this.instance = null;
  }
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  const propNames = Object.getOwnPropertyNames(obj);
  for (const name of propNames) {
    const value = (obj as any)[name];
    if (value && typeof value === "object") {
      deepFreeze(value);
    }
  }
  return Object.freeze(obj);
}
