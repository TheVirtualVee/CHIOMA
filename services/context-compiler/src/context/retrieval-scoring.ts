/** contract: HybridRetrieval */
export type HybridRetrievalInput = {
  semanticTopK: number;
  symbolicCommitmentIds: string[];
  customerId: string | null;
  businessEntityIds: string[];
};

/** constraint: recency decay logic */
export function recencyDecay(ageMs: number, halfLifeMs: number): number {
  if (halfLifeMs <= 0) return 0;
  return Math.pow(0.5, ageMs / halfLifeMs);
}

export function finalRelevanceScore(parts: {
  semanticSimilarity: number;
  commitmentWeight: number;
  businessPriority: number;
  ageMs: number;
  halfLifeMs: number;
}): number {
  const rd = recencyDecay(parts.ageMs, parts.halfLifeMs);
  return (
    parts.semanticSimilarity * parts.commitmentWeight * parts.businessPriority * rd
  );
}

export function buildHybridRetrievalHints(input: HybridRetrievalInput): {
  semanticTopK: number;
  symbolicCommitmentIds: string[];
  customerScoped: boolean;
  businessEntityIds: string[];
} {
  return {
    semanticTopK: input.semanticTopK,
    symbolicCommitmentIds: input.symbolicCommitmentIds,
    customerScoped: input.customerId !== null,
    businessEntityIds: input.businessEntityIds,
  };
}
