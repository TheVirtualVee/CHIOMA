import { describe, it, expect, beforeEach } from "vitest";
import { ECBLoader } from "./ecb.js";
import { resolveIntent } from "./resolution-engine.js";

const mockECB = {
  version: "1.0.0",
  intents: [
    { id: "PRICE_INQUIRY", priority: 100, patterns: ["how much", "price"], deprecated: false },
    { id: "SEND_MESSAGE", priority: 70, patterns: ["send", "message"], deprecated: false },
    { id: "ESCALATE_TO_LLM", priority: 10, patterns: ["?"], deprecated: false },
  ],
  resolutionPolicy: {
    tieBreakRule: "hash",
    memoryAlignmentWeight: 1.0,
  },
  config: {
    priorityOverrides: {},
  },
};

describe("ECB (Execution Contract Bundle) Immutability & Determinism", () => {
  beforeEach(() => {
    // Resetting singleton for testing (in production this is impossible after load)
    (ECBLoader as any).instance = null;
  });

  it("TEST 1: ECB Immutability (Double Load Rejection)", () => {
    ECBLoader.load(mockECB);
    expect(() => ECBLoader.load(mockECB)).toThrow(/GOVERNANCE_BLOCKED/);
  });

  it("TEST 2: Version Isolation & Deterministic Output", () => {
    ECBLoader.load(mockECB);
    const result = resolveIntent("how much", { tenantId: "t1" });
    expect(result).toBe("PRICE_INQUIRY");
  });

  it("TEST 3: No External Influence (Config Mutation Rejection)", () => {
    ECBLoader.load(mockECB);
    const bundle = ECBLoader.get();
    // Attempting to mutate returned frozen object
    expect(() => { (bundle.config as any).priorityOverrides["SEND_MESSAGE"] = 500; }).toThrow();
  });

  it("TEST 4: Deterministic Tie-break via ECB", () => {
    const tieECB = {
      ...mockECB,
      intents: [
        { id: "INTENT_A", priority: 100, patterns: ["conflict"], deprecated: false },
        { id: "INTENT_B", priority: 100, patterns: ["conflict"], deprecated: false },
      ]
    };
    ECBLoader.load(tieECB);
    
    const result1 = resolveIntent("conflict", { tenantId: "tenant_kalu" });
    const result2 = resolveIntent("conflict", { tenantId: "tenant_kalu" });
    expect(result1).toBe(result2); // Hash-based tie-break
  });

  it("TEST 5: Rule Collapse (DISE/ICL inside ECB)", () => {
    ECBLoader.load(mockECB);
    // Verified via resolveIntent mapping logic which now only consumes ECB intents
    expect(resolveIntent("price?", { tenantId: "t1" })).toBe("PRICE_INQUIRY");
  });
});
