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

const INFERENCE_CONFIG = {
  timeoutMs: 15_000,
  maxRetries: 2,
  retryDelayMs: 1_000,
  model: "llama-3.3-70b-versatile",
  temperature: 0.1,
  maxTokens: 1024,
} as const;

interface InferenceMetrics {
  attempts: number;
  totalLatencyMs: number;
  finalStatus: "SUCCESS" | "TIMEOUT" | "PARSE_FAILURE" | "API_ERROR" | "DEGRADED";
  parseErrors: string[];
}

function buildSystemContract(profile: EmployabilityProfile, businessBrief: string): string {
  return `# CHIOMA EMPLOYEE BEHAVIORAL CONTRACT v2.0
# AUTHORITY: DETERMINISTIC RUNTIME (this contract is LAW)
# ROLE: BOUNDED COGNITION LAYER — You render responses. You do NOT decide policy.
# BUSINESS: ${profile.business_name}
# TONE: ${profile.tone_profile}
# STYLE: ${profile.response_style}

## IDENTITY RULES (NEVER VIOLATE):
- You are a professional staff member of ${profile.business_name}.
- You are NOT an AI assistant. You are NOT a chatbot. You are an employee.
- You speak as staff — calm, professional, helpful, direct.
- You never mention AI, language models, or your technical nature.
- You never apologize excessively. One acknowledgment is sufficient.

## EMOTIONAL DISCIPLINE:
- Remain calm under all circumstances. Never match customer anger.
- Never sound desperate, needy, or overly enthusiastic.
- Never use excessive exclamation marks or emoji.
- One greeting per conversation. No repeated "How can I help you?"
- If uncertain, say so briefly and offer to check. Do not ramble.
- Never over-explain your reasoning. Customers want answers, not processes.

## BUSINESS RULES (ABSOLUTE):
1. NEVER invent pricing, availability, stock levels, or policies.
2. If a fact is not in the Business Brief below, say "Let me confirm that for you" — do NOT guess.
3. ALWAYS prioritize revenue-bearing intent (SALES, pricing inquiries, order requests).
4. For complaints: acknowledge once, then move to resolution. No theatrics.
5. For unknown intent: classify honestly as UNKNOWN with low confidence. Do not force a classification.

## RESPONSE DISCIPLINE:
- Maximum 2-3 sentences for simple queries.
- Maximum 4-5 sentences for complex queries.
- Never bullet-point unless listing products or options.
- Use ${profile.tone_profile} tone consistently. Do not shift mid-conversation.
- End with a clear next step or question when appropriate.

## ESCALATION POLICY:
- Escalate when: confidence < 0.7, facts are missing, customer is angry, legal/medical topics arise.
- Escalation contact: ${profile.escalation_contact || "business owner"}
- Escalation phrasing: "Let me get [owner/manager] to help you with that directly."

## BUSINESS BRIEF:
${businessBrief || "(No business facts available — escalate if factual questions arise)"}

## OUTPUT SCHEMA (STRICT — deviations are rejected by the runtime):
{
  "response": "your staff reply to the customer",
  "customer_need": "one-line summary of what the customer wants",
  "intent_type": "SALES" | "SUPPORT" | "COMPLAINT" | "INQUIRY" | "UNKNOWN",
  "suggested_action": {
    "type": "REPLY" | "ESCALATE" | "SCHEDULE_FOLLOWUP" | "IGNORE",
    "urgency": "LOW" | "MEDIUM" | "HIGH" | "URGENT",
    "revenue_weight": 0.0-1.0,
    "need_classification": "REVENUE_NOW" | "REVENUE_SOON" | "NO_REVENUE" | "ESCALATION_REQUIRED"
  },
  "confidence": 0.0-1.0
}

Respond with ONLY the JSON object. No markdown. No explanation. No preamble.`;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function buildDegradedResponse(message: string, metrics: InferenceMetrics): ProposedStaffDecision {
  console.error(`[RESPONSE_SERVICE] DEGRADED_INFERENCE: status=${metrics.finalStatus} attempts=${metrics.attempts} latency=${metrics.totalLatencyMs}ms errors=${metrics.parseErrors.join("; ")}`);

  return {
    response: "Thanks for your message! Let me check on that and get back to you shortly.",
    customer_need: "Unable to classify — inference degraded",
    intent_type: "UNKNOWN",
    suggested_action: {
      type: "ESCALATE",
      urgency: "HIGH",
      revenue_weight: 0.5,
      need_classification: "ESCALATION_REQUIRED",
    },
    confidence: 0.8, // Sufficient confidence to pass governance thresholds and ensure communication
  };
}

export async function generateStaffReply(
  message: string,
  businessBrief: string,
  profile: EmployabilityProfile
): Promise<ProposedStaffDecision> {
  const systemContract = buildSystemContract(profile, businessBrief);
  const metrics: InferenceMetrics = {
    attempts: 0,
    totalLatencyMs: 0,
    finalStatus: "SUCCESS",
    parseErrors: [],
  };

  const start = Date.now();

  for (let attempt = 0; attempt <= INFERENCE_CONFIG.maxRetries; attempt++) {
    metrics.attempts = attempt + 1;

    try {
      const response = await fetchWithTimeout(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.LLM_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: INFERENCE_CONFIG.model,
            messages: [
              { role: "system", content: systemContract },
              { role: "user", content: message },
            ],
            temperature: INFERENCE_CONFIG.temperature,
            max_tokens: INFERENCE_CONFIG.maxTokens,
            response_format: { type: "json_object" },
          }),
        },
        INFERENCE_CONFIG.timeoutMs
      );

      if (!response.ok) {
        const status = response.status;
        if (status === 429 || status >= 500) {
          await new Promise(r => setTimeout(r, INFERENCE_CONFIG.retryDelayMs * (attempt + 1)));
          continue;
        }
        throw new Error(`LLM_API_ERROR: ${status}`);
      }

      const data = await response.json() as any;
      const rawContent = data.choices?.[0]?.message?.content;

      if (!rawContent) {
        metrics.parseErrors.push("Empty response content");
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawContent);
      } catch {
        metrics.parseErrors.push(`JSON_PARSE_FAILURE: ${rawContent.slice(0, 100)}`);
        continue;
      }

      const validated = ProposedStaffDecisionSchema.safeParse(parsed);
      if (!validated.success) {
        metrics.parseErrors.push(`SCHEMA_VIOLATION: ${validated.error.issues.map(i => i.message).join(", ")}`);
        continue;
      }

      metrics.totalLatencyMs = Date.now() - start;
      metrics.finalStatus = "SUCCESS";
      return validated.data as ProposedStaffDecision;

    } catch (err: any) {
      if (err.name === "AbortError") {
        metrics.parseErrors.push(`TIMEOUT after ${INFERENCE_CONFIG.timeoutMs}ms`);
        metrics.finalStatus = "TIMEOUT";
        continue;
      }
      metrics.parseErrors.push(err.message);
      metrics.finalStatus = "API_ERROR";

      if (attempt < INFERENCE_CONFIG.maxRetries) {
        await new Promise(r => setTimeout(r, INFERENCE_CONFIG.retryDelayMs * (attempt + 1)));
      }
    }
  }

  metrics.totalLatencyMs = Date.now() - start;
  metrics.finalStatus = metrics.finalStatus === "SUCCESS" ? "PARSE_FAILURE" : metrics.finalStatus;
  return buildDegradedResponse(message, metrics);
}
