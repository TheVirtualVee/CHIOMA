import { describe, it, expect } from "vitest";
import { evaluateGates } from "../../core/arbiter/index.js";
import { ExecutionRequest } from "../../core/contracts/index.js";

describe("Phase 3.1 — CHIOMA Execution Arbiter (CEA) Mandatory Scenarios", () => {

  const baseRequest: ExecutionRequest = {
    tenantId: "tenant_test",
    instanceId: "inst_test",
    triggeredBy: "whatsapp_message",
    commitmentPending: false,
    creditBalance: 100,
    creditRequired: 1,
    tenantStatus: "active",
    safetyFlags: [],
    requestedAt: Date.now()
  };

  it("Scenario A: Billing overrides commitment (Insufficient credit + Commitment)", () => {
    const request: ExecutionRequest = {
      ...baseRequest,
      creditBalance: 0,
      commitmentPending: true,
      tenantStatus: "trial_expired" // Non-active status
    };
    const verdict = evaluateGates(request);
    expect(verdict.outcome).toBe("BLOCK_RESPONSE");
    expect(verdict.controllerTriggered).toBe("Gate1_Billing");
  });

  it("Scenario B: Commitment override allowed (Healthy billing + Commitment)", () => {
    const request: ExecutionRequest = {
      ...baseRequest,
      commitmentPending: true
    };
    const verdict = evaluateGates(request);
    expect(verdict.outcome).toBe("ALLOW_WITH_CONTEXT_OVERRIDE");
    expect(verdict.controllerTriggered).toBe("Gate4_Commitment");
  });

  it("Scenario C: Suspended tenant always blocked", () => {
    const request: ExecutionRequest = {
      ...baseRequest,
      tenantStatus: "suspended"
    };
    const verdict = evaluateGates(request);
    expect(verdict.outcome).toBe("BLOCK_RESPONSE");
    expect(verdict.controllerTriggered).toBe("Gate2_TenantValidity");
  });

  it("Scenario D: Cold start expired trial", () => {
    const request: ExecutionRequest = {
      ...baseRequest,
      tenantStatus: "trial_expired"
    };
    const verdict = evaluateGates(request);
    expect(verdict.outcome).toBe("BLOCK_RESPONSE");
    expect(verdict.controllerTriggered).toBe("Gate2_TenantValidity");
  });

  it("Scenario E: Clean execution", () => {
    const request: ExecutionRequest = { ...baseRequest };
    const verdict = evaluateGates(request);
    expect(verdict.outcome).toBe("ALLOW");
    expect(verdict.controllerTriggered).toBe("Gate6_Default");
  });

  it("Scenario F: ABM cannot bypass billing", () => {
    const request: ExecutionRequest = {
      ...baseRequest,
      triggeredBy: "abm_schedule",
      creditBalance: 0,
      tenantStatus: "trial_expired"
    };
    const verdict = evaluateGates(request);
    expect(verdict.outcome).toBe("BLOCK_RESPONSE");
    expect(verdict.controllerTriggered).toBe("Gate1_Billing");
  });
});
