import { z } from "zod";
import type { BusinessDraft } from "../../core/contracts/index.js";

/**
 * services/business-learning/index.ts
 *
 * CHIOMA BUSINESS LEARNING.
 * Analyzes social media and website signals to train the digital employee.
 */

const BusinessDraftSchema = z.object({
  name_guess: z.string(),
  products_guess: z.array(z.string()),
  pricing_guess: z.string().optional(),
  tone_guess: z.string(),
  location_guess: z.string().optional(),
  working_pattern_guess: z.string().optional(),
  confidence_scores: z.record(z.number()),
});

export async function generateBusinessDraft(
  linkContents: string[]
): Promise<BusinessDraft> {
  const combinedText = linkContents.join("\n\n---\n\n");

  const staffInstructions = `You are CHIOMA, a new digital employee learning about a business.
Read the following public data from the business's social links and provide a structured draft of what you understand about your new employer's business.
This is INFERENCE, not truth. Be honest about confidence.

EXTRACT:
1. Business Name
2. Top Products/Services
3. Pricing patterns (if visible)
4. Tone of voice (friendly, luxury, etc)
5. Location (if visible)
6. Working hours (if visible)

Return ONLY JSON:
{
  "name_guess": string,
  "products_guess": string[],
  "pricing_guess": string,
  "tone_guess": string,
  "location_guess": string,
  "working_pattern_guess": string,
  "confidence_scores": { "name": 0-1, "products": 0-1, ... }
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
        { role: "user", content: `SOCIAL DATA:\n${combinedText}` },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) throw new Error(`BUSINESS_LEARNING_ERROR: ${response.status}`);

  const data = await response.json() as any;
  const rawContent = data.choices[0].message.content;
  
  return BusinessDraftSchema.parse(JSON.parse(rawContent)) as BusinessDraft;
}

export function formatDraftForEmployer(draft: BusinessDraft): string {
  return `I've finished my research! Here is what I've learned about your business:

🏢 *Business Name*: ${draft.name_guess}
🛍️ *What you sell*: ${draft.products_guess.join(", ")}
💰 *Pricing*: ${draft.pricing_guess || "Not specified"}
📍 *Location*: ${draft.location_guess || "Not specified"}
🕒 *Hours*: ${draft.working_pattern_guess || "Not specified"}
✨ *Tone*: I'll respond in a ${draft.tone_guess} style.

Does this look correct to you? Please tell me what I should fix or add!`;
}

