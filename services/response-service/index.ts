import { z } from "zod";
import type { ProposedStaffDecision } from "../../core/contracts/index.js";

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

  // Resolve provider from env — LLM_PROVIDER controls which endpoint is used.
  // ASSERT: default to Groq (fast + cheap) but respect operator configuration.
  const provider = process.env.LLM_PROVIDER ?? "groq";
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) throw new Error("LLM_API_KEY not set");

  const PROVIDER_CONFIG: Record<string, { url: string; defaultModel: string }> = {
    groq:       { url: "https://api.groq.com/openai/v1/chat/completions",        defaultModel: "llama-3.3-70b-versatile" },
    openai:     { url: "https://api.openai.com/v1/chat/completions",             defaultModel: "gpt-4o-mini" },
    openrouter: { url: "https://openrouter.ai/api/v1/chat/completions",          defaultModel: "mistralai/mistral-7b-instruct" },
  };

  const cfg = PROVIDER_CONFIG[provider] ?? PROVIDER_CONFIG["groq"];
  const model = process.env.LLM_MODEL ?? cfg.defaultModel;

  // ASSERT: timeout enforced — LLM must not stall the serverless function
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  let response: Response;
  try {
    response = await fetch(cfg.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: staffInstructions },
          { role: "user", content: message },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err instanceof Error && err.name === "AbortError";
    throw new Error(isTimeout ? `LLM_TIMEOUT: ${provider} did not respond within 12s` : `LLM_FETCH_ERROR: ${String(err)}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`STAFF_REPLY_ERROR [${provider}] HTTP_${response.status}: ${errBody}`);
  }

  const data = await response.json() as any;
  const rawContent = data.choices[0].message.content;
  
  return ProposedStaffDecisionSchema.parse(JSON.parse(rawContent)) as ProposedStaffDecision;
}
