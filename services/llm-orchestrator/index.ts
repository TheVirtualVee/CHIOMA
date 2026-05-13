import { z } from "zod";
import type { LlmOutput } from "../../core/contracts/index.js";

/**
 * services/llm-orchestrator/index.ts
 *
 * The Employee's Brain.
 * Classified messages into revenue-priority staff actions.
 */

const LlmOutputSchema = z.object({
  response: z.string().min(1),
  intent: z.string(),
  action: z.object({
    type: z.enum(["REPLY", "ESCALATE", "SCHEDULE_FOLLOWUP", "IGNORE"]),
    urgency: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
    revenue_weight: z.number().min(0).max(1),
    intent_classification: z.enum(["REVENUE_NOW", "REVENUE_SOON", "NO_REVENUE", "ESCALATION_REQUIRED"]),
  }),
  confidence: z.number().min(0).max(1),
});

export async function generateStaffResponse(
  message: string,
  context: string,
  profile: any
): Promise<LlmOutput> {
  const systemPrompt = `You are the digital staff for "${profile.business_name}".
TONE: ${profile.tone_profile}
STYLE: ${profile.response_style}
CONTEXT:
${context || "(No facts provided)"}

BEHAVIORAL RULES:
- Never leave a message idle. Always end with a question, confirmation, or action.
- Be concise. Use local-style phrasing (Nigerian SMB context). No robotic AI talk.
- Classify intent into: REVENUE_NOW (buying/price), REVENUE_SOON (inquiry), NO_REVENUE (chat/spam).

Return ONLY JSON:
{
  "response": string,
  "intent": string,
  "action": {
    "type": "REPLY" | "ESCALATE" | "SCHEDULE_FOLLOWUP" | "IGNORE",
    "urgency": "LOW" | "MEDIUM" | "HIGH" | "URGENT",
    "revenue_weight": number,
    "intent_classification": "REVENUE_NOW" | "REVENUE_SOON" | "NO_REVENUE" | "ESCALATION_REQUIRED"
  },
  "confidence": number
}`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.LLM_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
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
