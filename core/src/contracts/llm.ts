export type LlmStructuredOutput = {
  response: string;
  intent: string;
  proposed_commitments: unknown[];
  confidence: number;
};
