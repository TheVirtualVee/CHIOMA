import { z } from "zod";
import type { ProposedStaffDecision } from "../../core/contracts/index.js";

/**
 * services/response-service/index.ts
 *
 * STAFF CONVERSATIONAL RENDERER.
 * Generates how CHIOMA speaks, but does not govern operational authority.
 */

const ProposedStaffDecisionSchema = z.object({
  response: z.string().min(1),
  customer_need: z.string(),
  suggested_action: z.object({
    type: z.enum(["REPLY", "ESCALATE", "SCHEDULE_FOLLOWUP", "IGNORE"]),
    urgency: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
    revenue_weight: z.number().min(0).max(1),
    need_classification: z.enum(["REVENUE_NOW", "REVENUE_SOON", "NO_REVENUE", "ESCALATION_REQUIRED"]),
  }),
  confidence: z.number().min(0).max(1),
});

export async function generateStaffReply(
  message: string,
  businessBrief: string,
  profile: any
): Promise<ProposedStaffDecision> {
  const staffInstructions = `You are the digital staff for "${profile.business_name}".
TONE: ${profile.tone_profile}
STYLE: ${profile.response_style}

ROLE: You are a CONVERSATIONAL RENDERER. 
Your goal is to phrase a reply that is empathetic, human, and clear.
You do NOT have operational authority. Your "suggested_action" is a proposal to the deterministic system.

BUSINESS BRIEF (Authoritative Facts):
${businessBrief || "(No facts provided)"}

CONVERSATIONAL GUIDELINES:
- Be concise. Use local-style phrasing (Nigerian SMB context). No robotic AI talk.
- Never hallucinate prices, availability, or policies not in the Business Brief.
- If unsure, suggest ESCALATE to notify the owner.

Return ONLY JSON:
{
  "response": string,
  "customer_need": string,
  "suggested_action": {
    "type": "REPLY" | "ESCALATE" | "SCHEDULE_FOLLOWUP" | "IGNORE",
    "urgency": "LOW" | "MEDIUM" | "HIGH" | "URGENT",
    "revenue_weight": number,
    "need_classification": "REVENUE_NOW" | "REVENUE_SOON" | "NO_REVENUE" | "ESCALATION_REQUIRED"
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
        { role: "system", content: staffInstructions },
        { role: "user", content: message },
      ],
      temperature: 0.1, // Slight variance for conversational fluidity
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) throw new Error(`STAFF_REPLY_ERROR: ${response.status}`);

  const data = await response.json() as any;
  const rawContent = data.choices[0].message.content;
  
  return ProposedStaffDecisionSchema.parse(JSON.parse(rawContent)) as ProposedStaffDecision;
}


