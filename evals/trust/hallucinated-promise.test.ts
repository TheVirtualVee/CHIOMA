import { describe, expect, it } from "vitest";
import { validateCommitmentCandidate } from "@chioma/core";

describe("eval: hallucinated / unsafe commitments", () => {
  it("rejects CRITICAL-looking promise with insufficient confidence", () => {
    const r = validateCommitmentCandidate({
      origin: "explicit",
      type: "booking",
      severity: "CRITICAL",
      ambiguityScore: 0.1,
      confidenceScore: 0.8,
      deadlineIso: "2099-01-01T00:00:00.000Z",
      businessSupports: true,
      feasibilityConfirmed: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.error.code).toBe("CONFIDENCE_TOO_LOW");
  });
});
