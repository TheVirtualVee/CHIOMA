import { z } from "zod";
import type { ProposedStaffDecision, EmployabilityProfile } from "../../core/contracts/index.js";

const ProposedStaffDecisionSchema = z.object({
  response: z.string().min(1),
  customer_need: z.string(),
  intent_type: z.enum(["SALES", "SUPPORT", "COMPLAINT", "INQUIRY", "UNKNOWN"]),
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
  profile: EmployabilityProfile
): Promise<ProposedStaffDecision> {
  const systemContract = `
# CHIOMA BEHAVIORAL CONTRACT v1.0
# ROLE: CONVERSATIONAL RENDERER & INTENT CLASSIFIER
# BUSINESS: ${profile.business_name}
# TONE: ${profile.tone_profile}
# STYLE: ${profile.response_style}

## OPERATIONAL POLICIES:
1. NEVER invent pricing, availability, or policies not in the Business Brief.
2. ALWAYS prioritize revenue intent (SALES).
3. ESCALATE (type: ESCALATE) if confidence < 0.7 or facts are missing.
4. Output MUST be valid JSON matching the StaffDecision schema.
5. Use Nigerian SMB local phrasing (friendly, professional, concise).
6. Never perform side effects or promise future actions yourself.

## BUSINESS BRIEF:
${businessBrief || "(No facts provided)"}

## RESPONSE SCHEMA:
{
  "response": "human-like reply",
  "customer_need": "brief summary of user need",
  "intent_type": "SALES" | "SUPPORT" | "COMPLAINT" | "INQUIRY" | "UNKNOWN",
  "suggested_action": {
    "type": "REPLY" | "ESCALATE" | "SCHEDULE_FOLLOWUP" | "IGNORE",
    "urgency": "LOW" | "MEDIUM" | "HIGH" | "URGENT",
    "revenue_weight": 0.0-1.0,
    "need_classification": "REVENUE_NOW" | "REVENUE_SOON" | "NO_REVENUE" | "ESCALATION_REQUIRED"
  },
  "confidence": 0.0-1.0
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
        { role: "system", content: systemContract },
        { role: "user", content: message },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) throw new Error(`STAFF_REPLY_ERROR: ${response.status}`);

  const data = await response.json() as any;
  const rawContent = data.choices[0].message.content;
  
  return ProposedStaffDecisionSchema.parse(JSON.parse(rawContent)) as ProposedStaffDecision;
}
