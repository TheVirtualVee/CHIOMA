import { describe, it, expect, beforeEach } from "vitest";
import { ConfigurationBoundary } from "./config-boundary.js";
import { resolveIntent } from "./resolution-engine.js";

describe("Final Production Hardening Validation", () => {
  beforeEach(() => {
    ConfigurationBoundary.reset();
  });

  it("TEST 1: External Config Injection (Priority Overrides)", () => {
    ConfigurationBoundary.validateAndSet({
      version: "1.0.0",
      priorityOverrides: {
        "SEND_MESSAGE": 200 // Default is 70
      }
    });

    const context = { tenantId: "t1" };
    // "send price" matches SEND_MESSAGE (200) and PRICE_INQUIRY (100)
    const result = resolveIntent("send price", context);
    expect(result).toBe("SEND_MESSAGE");
  });

  it("TEST 2: Version Drift Stability", () => {
    const input = "send price";
    const context = { tenantId: "t1" };

    // Version A
    ConfigurationBoundary.validateAndSet({ version: "v1", priorityOverrides: { "SEND_MESSAGE": 200 } });
    expect(resolveIntent(input, context)).toBe("SEND_MESSAGE");

    // Version B
    ConfigurationBoundary.reset();
    ConfigurationBoundary.validateAndSet({ version: "v2", priorityOverrides: { "PRICE_INQUIRY": 300 } });
    expect(resolveIntent(input, context)).toBe("PRICE_INQUIRY");
  });

  it("TEST 3: Rule Independence", () => {
    ConfigurationBoundary.validateAndSet({ version: "v1" });
    const result = resolveIntent("send price", { tenantId: "t1" });
    expect(result).toBe("PRICE_INQUIRY"); // Default priority 100 > 70
  });

  it("TEST 4: Failure Mode Isolation (Invalid Config)", () => {
    expect(() => {
      ConfigurationBoundary.validateAndSet({ version: 123 }); // Invalid type
    }).toThrow();

    expect(() => {
      resolveIntent("test", { tenantId: "t1" });
    }).toThrow(/CONFIG_INVALID/);
  });

  it("TEST 5: High-Load Determinism", () => {
    ConfigurationBoundary.validateAndSet({ version: "v1" });
    const input = "buy now";
    const context = { tenantId: "t1" };
    const first = resolveIntent(input, context);
    
    for (let i = 0; i < 100; i++) {
      expect(resolveIntent(input, context)).toBe(first);
    }
  });
});
