import { z } from "zod";
import type { BusinessDraft } from "../../core/contracts/index.js";

/**
 * services/business-learning/index.ts
 *
 * CHIOMA BUSINESS LEARNING.
 * Analyzes social media and website signals to train the digital employee.
 */

const BusinessModelSchema = z.object({
  name_guess: z.string(),
  entities: z.array(z.object({
    category: z.string(), // e.g. "Accommodation", "Consultation", "Physical Product"
    label: z.string(),    // e.g. "Deluxe Room", "1-hour session"
    price_point: z.string().optional(),
    billing_unit: z.string().optional() // e.g. "per night", "fixed"
  })),
  workflow_guess: z.object({
    booking_process: z.string(), // How customers book
    payment_terms: z.string(),   // Deposit vs Full vs Post-pay
    customer_qualifier: z.string() // What info is needed from customer
  }),
  tone_guess: z.string(),
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
2. Operational Entities (What is being sold? Include unit like "per night")
3. Booking Workflow (How does a customer secure a slot/product?)
4. Payment Terms (Upfront, deposit, etc.)
5. Tone of voice (friendly, luxury, etc)

Return ONLY JSON:
{
  "name_guess": string,
  "entities": [{ "category": string, "label": string, "price_point": string, "billing_unit": string }],
  "workflow_guess": { "booking_process": string, "payment_terms": string, "customer_qualifier": string },
  "tone_guess": string,
  "confidence_scores": { "name": 0-1, "entities": 0-1, "workflow": 0-1 }
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
  
  return BusinessModelSchema.parse(JSON.parse(rawContent)) as BusinessDraft;
}

export function formatDraftForEmployer(draft: BusinessDraft): string {
  const entitySummary = draft.entities
    .map(e => `• ${e.label} (${e.category}) - ${e.price_point || 'Price unknown'} ${e.billing_unit || ''}`)
    .join("\n");

  return `I've finished my research! Here is how I understand your business logic:

🏢 *Business Name*: ${draft.name_guess}

🛍️ *Operational Entities*:
${entitySummary}

⚙️ *Workflow*:
- Booking: ${draft.workflow_guess.booking_process}
- Payment: ${draft.workflow_guess.payment_terms}
- Customer Info Needed: ${draft.workflow_guess.customer_qualifier}

✨ *Tone*: I'll respond in a ${draft.tone_guess} style.

Does this look correct to you? Please tell me what I should fix or add!`;
}

