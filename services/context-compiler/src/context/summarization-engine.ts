/** contract: WarmColdSummarize */
export type WarmColdSummarizeInput = {
  warmInteractions: unknown[];
  coldArchive: unknown[];
  tokenBudget: number;
};

/** constraint: compress only non-critical tiers */
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
