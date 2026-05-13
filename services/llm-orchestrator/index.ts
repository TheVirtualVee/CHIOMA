import { z } from "zod";
import type { LlmOutput } from "../../core/contracts/index.js";

/**
 * services/llm-orchestrator/index.ts
 *
 * Handles all AI interactions. Enforces structured output validation.
 * Optimized for Revenue Event Detection.
 */

const LlmOutputSchema = z.object({
  response: z.string().min(1),
  intent: z.string(),
  is_revenue_intent: z.boolean().default(false),
  revenue_classification: z.object({
    type: z.enum(["BUY_INTENT", "INQUIRY", "SUPPORT", "OTHER"]),
    urgency: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
    value_estimate: z.number().optional(),
    recommended_action: z.enum(["RESPOND_IMMEDIATELY", "ESCALATE_TO_OWNER", "SCHEDULE_FOLLOWUP", "IGNORE"]),
  }).optional(),
  proposed_commitments: z.array(z.any()),
  confidence: z.number().min(0).max(1),
});

export async function generateResponse(
  message: string,
  context: string,
  config: { apiKey: string; provider: string; model?: string }
): Promise<LlmOutput> {
  const systemPrompt = `You are CHIOMA, a real-time revenue reflex layer for small businesses.
BUSINESS CONTEXT:
${context || "(No facts provided)"}

Return ONLY JSON:
{
  "response": string,
  "intent": string,
  "is_revenue_intent": boolean,
  "revenue_classification": {
    "type": "BUY_INTENT" | "INQUIRY" | "SUPPORT" | "OTHER",
    "urgency": "LOW" | "MEDIUM" | "HIGH" | "URGENT",
    "value_estimate": number,
    "recommended_action": "RESPOND_IMMEDIATELY" | "ESCALATE_TO_OWNER" | "SCHEDULE_FOLLOWUP" | "IGNORE"
  },
  "proposed_commitments": [],
  "confidence": number
}

CLASSIFICATION RULES:
- Set is_revenue_intent=true if message relates to money, prices, or buying.
- If urgency="URGENT" or type="BUY_INTENT", recommended_action should be "ESCALATE_TO_OWNER" or "RESPOND_IMMEDIATELY".`;

  const baseUrl = config.provider === "groq" 
    ? "https://api.groq.com/openai/v1" 
    : "https://api.openai.com/v1";

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model ?? (config.provider === "groq" ? "llama-3.3-70b-versatile" : "gpt-4o-mini"),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) throw new Error(`LLM_API_ERROR: ${response.status}`);

  const data = await response.json();
  const rawContent = data.choices[0].message.content;
  
  return LlmOutputSchema.parse(JSON.parse(rawContent)) as LlmOutput;
}
