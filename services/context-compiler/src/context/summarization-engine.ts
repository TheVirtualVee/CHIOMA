/**
 * v1.1 — compress ONLY warm/cold tiers; never drop commitments/safety (enforced by caller).
 */
export type WarmColdSummarizeInput = {
  warmInteractions: unknown[];
  coldArchive: unknown[];
  tokenBudget: number;
};

export function summarizeWarmColdOnly(input: WarmColdSummarizeInput): {
  compressedWarm: unknown[];
  compressedCold: unknown[];
  droppedTokensEstimate: number;
} {
  if (input.tokenBudget <= 0) {
    return { compressedWarm: [], compressedCold: [], droppedTokensEstimate: 0 };
  }
  return {
    compressedWarm: input.warmInteractions,
    compressedCold: input.coldArchive,
    droppedTokensEstimate: 0,
  };
}
