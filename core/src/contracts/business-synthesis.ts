/**
 * Structured output from Business Synthesis Engine (v1.1).
 * Operational truth requires owner confirmation events — never trust raw extraction alone.
 */
export type ProvenanceFact = {
  fact: string;
  source_type: string;
  source_url: string;
  confidence: number;
  verified_by_owner: boolean;
  extracted_at: string;
};

export type BusinessSynthesisProposal = {
  business_name: string;
  services: string[];
  products: string[];
  pricing_detected: unknown[];
  operating_hours: Record<string, unknown>;
  languages_detected: string[];
  tone_inference: Record<string, unknown>;
  escalation_candidates: unknown[];
  confidence_scores: Record<string, number>;
  provenance: ProvenanceFact[];
};
