import { describe, it, expect } from "vitest";
import { evaluateGates } from "../../core/arbiter/index.js";
import { ExecutionRequest } from "../../core/contracts/index.js";

describe("Phase 3.2 — CHAOS LAYER (Production Hardening)", () => {

  const baseRequest: ExecutionRequest = {
    tenantId: "tenant_chaos",
    instanceId: "inst_chaos",
    triggeredBy: "whatsapp_message",
    commitmentPending: false,
    activeCommitmentCount: 0,
    creditBalance: 100,
    creditRequired: 1,
    tenantStatus: "active",
    safetyFlags: [],
    requestedAt: Date.now(),
    fingerprint: "chaos_hash_123",
    identityId: "identity_123",
    schedulerConflict: false
  };

  it("Hardening: Scheduler Arbitration (Gate 0 Precedence)", () => {
    // Scenario: Recovery worker or ABM is already acting on this conversation
    const request: ExecutionRequest = {
      ...baseRequest,
      schedulerConflict: true
    };
    
    const verdict = evaluateGates(request);
    
    expect(verdict.outcome).toBe("BLOCK_RESPONSE");
    expect(verdict.controllerTriggered).toBe("Gate0_Arbitration");
    expect(verdict.gateTrace[0].gate).toBe("scheduler_arbitration");
    expect(verdict.gateTrace[0].decision).toBe("blocked");
  });


  it("Hardening: Commitment Throttling (Prevents Recovery DoS)", () => {
    // Scenario: User already has 1 active commitment, and tries to trigger another
    const request: ExecutionRequest = {
      ...baseRequest,
      commitmentPending: true,
      activeCommitmentCount: 1
    };
    
    const verdict = evaluateGates(request);
    
    // Outcome should be ALLOW (normal path) NOT ALLOW_WITH_CONTEXT_OVERRIDE (priority path)
    // This prevents the system from getting "stuck" in high-priority loops for spammers
    expect(verdict.outcome).toBe("ALLOW");
    expect(verdict.controllerTriggered).toBe("Gate3_Throttling");
    expect(verdict.gateTrace.find(t => t.gate === 'commitment_throttling')?.decision).toBe('triggered');
  });

  it("Hardening: Gate Trace Audit Trail (Deep Observability)", () => {
    const request: ExecutionRequest = {
      ...baseRequest,
      creditBalance: 0,
      tenantStatus: "trial_expired"
    };
    
    const verdict = evaluateGates(request);
    
    expect(verdict.gateTrace.length).toBeGreaterThan(0);
    expect(verdict.gateTrace[0].gate).toBe("tenant");
    expect(verdict.gateTrace[0].decision).toBe("blocked");
  });

  it("Hardening: Absolute Precedence (Billing > Commitment)", () => {
    // Even if throttling would happen, Billing Block happens FIRST
    const request: ExecutionRequest = {
      ...baseRequest,
      creditBalance: 0,
      tenantStatus: "trial_expired",
      commitmentPending: true,
      activeCommitmentCount: 10 // Chaos level spammed commitments
    };
    
    const verdict = evaluateGates(request);
    
    expect(verdict.outcome).toBe("BLOCK_RESPONSE");
    expect(verdict.controllerTriggered).toBe("Gate1_TenantValidity");
    // Ensure billing is the first entry in trace
    expect(verdict.gateTrace[0].gate).toBe("tenant");
  });
});
