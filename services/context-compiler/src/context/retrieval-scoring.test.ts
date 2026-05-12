import { describe, expect, it } from "vitest";
import { finalRelevanceScore, recencyDecay } from "./retrieval-scoring.js";

describe("retrieval-scoring (v1.1)", () => {
  it("recencyDecay halves at halfLife", () => {
    expect(recencyDecay(1000, 1000)).toBeCloseTo(0.5, 5);
  });

  it("finalRelevanceScore multiplies components", () => {
    const s = finalRelevanceScore({
      semanticSimilarity: 0.8,
      commitmentWeight: 1.2,
      businessPriority: 1.0,
      ageMs: 0,
      halfLifeMs: 86_400_000,
    });
    expect(s).toBeGreaterThan(0.9);
  });
});
