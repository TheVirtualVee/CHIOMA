/** contract: BusinessTraining */
export type BusinessTrainingProposal = {
  operational_rules: string[];
  escalation_policies: string[];
  forbidden_promises: string[];
  upsell_preferences: string[];
  tone_calibration: Record<string, unknown>;
  multilingual_boundaries: string[];
};
