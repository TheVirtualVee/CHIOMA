import { z } from "zod";

export const ActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("SEND_MESSAGE"),
    recipientId: z.string(),
    content: z.string().max(4096),
    urgency: z.enum(["NORMAL", "HIGH"]),
  }),
  z.object({
    type: z.literal("ESCALATE_TO_HUMAN"),
    reason: z.string().max(500),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  }),
  z.object({
    type: z.literal("RECORD_CUSTOMER_NEED"),
    needType: z.string(),
    detail: z.string().max(500),
  }),
  z.object({
    type: z.literal("SCHEDULE_FOLLOWUP"),
    reason: z.string().max(500),
  }),
  z.object({
    type: z.literal("NO_ACTION"),
    rationale: z.string().max(500),
  }),
]);

export const LLMProposalSchema = z.object({
  proposalId: z.string(),
  intents: z
    .array(
      z.object({
        intent: z.enum(["ACKNOWLEDGE", "INFORM", "SELL", "SUPPORT", "ESCALATE", "CLARIFY"]),
        confidence: z.number().min(0).max(1),
      })
    )
    .min(1)
    .max(5),
  primaryIntent: z.enum(["ACKNOWLEDGE", "INFORM", "SELL", "SUPPORT", "ESCALATE", "CLARIFY"]),
  overallConfidence: z.number().min(0).max(1),
  proposedActions: z.array(ActionSchema).max(3),
  reasoning: z.string().max(1000),
});

export type LLMProposal = z.infer<typeof LLMProposalSchema>;
export type ProposedAction = z.infer<typeof ActionSchema>;

export const CONFIDENCE_THRESHOLDS: Record<string, number> = {
  SEND_MESSAGE: 0.75,
  RECORD_CUSTOMER_NEED: 0.70,
  SCHEDULE_FOLLOWUP: 0.70,
  ESCALATE_TO_HUMAN: 0.50,
  NO_ACTION: 0.60,
};

export interface PromptVersion {
  readonly promptId: string;
  readonly version: number;
  readonly systemPrompt: string;
  readonly userPromptTemplate: string;
  readonly modelId: string;
  readonly deployedAt: string;
  readonly deprecatedAt: string | null;
  readonly testSuitePassRate: number;
}
