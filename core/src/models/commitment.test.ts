import { describe, expect, it } from "vitest";
import { validateCommitmentCandidate } from "./commitment.js";
import { DEFAULT_COMMITMENT_POLICY } from "../policies/commitment-policy.js";

describe("validateCommitmentCandidate", () => {
  const base = {
    origin: "explicit" as const,
    type: "booking" as const,
    ambiguityScore: 0.2,
    confidenceScore: 0.9,
    deadlineIso: "2099-01-01T00:00:00.000Z",
    businessSupports: true,
    feasibilityConfirmed: true,
  };

  it("rejects when confidence is below policy minimum", () => {
    const r = validateCommitmentCandidate(
      { ...base, confidenceScore: 0.2 },
      DEFAULT_COMMITMENT_POLICY,
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.error.code).toBe("CONFIDENCE_TOO_LOW");
  });

  it("rejects when ambiguity exceeds policy maximum", () => {
    const r = validateCommitmentCandidate(
      { ...base, ambiguityScore: 0.95 },
      DEFAULT_COMMITMENT_POLICY,
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.error.code).toBe("AMBIGUITY_TOO_HIGH");
  });

  it("rejects when business state does not support the commitment", () => {
    const r = validateCommitmentCandidate(
      { ...base, businessSupports: false },
      DEFAULT_COMMITMENT_POLICY,
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.error.code).toBe("BUSINESS_NOT_SUPPORTED");
  });

  it("rejects when feasibility is not confirmed", () => {
    const r = validateCommitmentCandidate(
      { ...base, feasibilityConfirmed: false },
      DEFAULT_COMMITMENT_POLICY,
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.error.code).toBe("FEASIBILITY_NOT_CONFIRMED");
  });

  it("accepts a candidate that satisfies the full contract", () => {
    const r = validateCommitmentCandidate(base, DEFAULT_COMMITMENT_POLICY);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected success");
    expect(r.value.status).toBe("pending");
    expect(r.value.severity).toBe("MEDIUM");
  });

  it("applies stricter confidence for CRITICAL severity (v1.1)", () => {
    const r = validateCommitmentCandidate({
      ...base,
      severity: "CRITICAL",
      confidenceScore: 0.86,
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.error.code).toBe("CONFIDENCE_TOO_LOW");
  });
});
