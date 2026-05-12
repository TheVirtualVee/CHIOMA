import { describe, it, expect, vi, beforeEach } from "vitest";
import { mapInstruction } from "./execution-mapper.js";
import { resolveIntent } from "./resolution-engine.js";
import { intentRegistry } from "./intent-registry.js";
import { ConfigurationBoundary } from "./config-boundary.js";

/** contract: ExecutionGovernanceTests */
describe("Execution Governance & Determinism", () => {
  beforeEach(() => {
    ConfigurationBoundary.validateAndSet({ version: "1.0.0" });
  });

  const context = { tenantId: "tenant_kalu" };

  describe("Intent Resolution (ICL)", () => {
    it("should resolve messy human language to canonical intents", () => {
      expect(mapInstruction("this thing you sell how much again?", context)).toBe("PRICE_INQUIRY");
      expect(mapInstruction("you people are too expensive honestly", context)).toBe("RETENTION_SIGNAL");
      expect(mapInstruction("send me info", context)).toBe("SEND_MESSAGE");
      expect(mapInstruction("do the usual for me", context)).toBe("REPEAT_LAST_ACTION");
    });

    it("should minimize ESCALATE_TO_LLM via priority-based governor", () => {
      // "how much again" has priority 100 (PRICE_INQUIRY)
      expect(mapInstruction("how much again?", context)).toBe("PRICE_INQUIRY");
      // "but" triggers ESCALATE_TO_LLM only if no higher priority match
      expect(mapInstruction("I want it but maybe not", context)).toBe("ESCALATE_TO_LLM");
    });

    it("should break ties deterministically via hash rule", () => {
      // Simulate priority tie
      intentRegistry.push({
        id: "CREATE_EVENT",
        version: "1.0.0",
        priority: 100, // Same as PRICE_INQUIRY
        deprecated: false,
        patterns: ["how much"],
      });

      const result1 = mapInstruction("how much", { tenantId: "t1" });
      const result2 = mapInstruction("how much", { tenantId: "t1" });
      expect(result1).toBe(result2);

      intentRegistry.pop();
    });

    it("should be independent of rule registration order", () => {
      const input = "send price"; 
      const resultBefore = mapInstruction(input, context);
      
      intentRegistry.sort(() => Math.random() - 0.5);
      const resultAfter = mapInstruction(input, context);
      
      expect(resultBefore).toBe(resultAfter);
    });
  });

  describe("Base Mapping", () => {
    it("should map canonical keywords correctly", () => {
      expect(mapInstruction("commitment")).toBe("UPDATE_COMMITMENT");
      expect(mapInstruction("event")).toBe("CREATE_EVENT");
      expect(mapInstruction("replay")).toBe("REPLAY_EVENTS");
      expect(mapInstruction("status")).toBe("QUERY_STATE");
    });

    it("should handle empty or unknown inputs safely", () => {
      expect(mapInstruction("")).toBe("UNCLASSIFIED");
      expect(mapInstruction("random gibberish")).toBe("UNCLASSIFIED");
    });
  });
});
