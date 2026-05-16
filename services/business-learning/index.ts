import { z } from "zod";
import type { BusinessDraft } from "../../core/contracts/index.js";
import { SocialPost } from "./types.js";
import { fetchInstagramPosts } from "./adapters/instagram.js";
import { fetchTikTokPosts } from "./adapters/tiktok.js";

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

/**
 * Orchestrates social discovery for a tenant.
 * Enforces a 15-minute rate limit per platform.
 */
export async function runSocialDiscovery(
  sql: any,
  tenantId: string,
  credentials: { instagram?: { accessToken: string, businessId: string }, tiktok?: { accessToken: string } }
): Promise<SocialPost[]> {
  // 1. Fetch tenant-specific handles
  const [profile] = await sql`SELECT instagram_handle, tiktok_handle FROM public.tenant_social_profiles WHERE tenant_id = ${tenantId}`;
  if (!profile) {
    console.warn(`[SOCIAL_DISCOVERY] No social profile found for tenant ${tenantId}`);
    return [];
  }

  const [instance] = await sql`SELECT last_instagram_fetch, last_tiktok_fetch FROM public.chioma_instances WHERE tenant_id = ${tenantId}`;
  if (!instance) return [];

  const now = new Date();
  const FIFTEEN_MINS = 15 * 60 * 1000;
  
  const allPosts: SocialPost[] = [];

  // Instagram Discovery
  const igLastFetch = instance.last_instagram_fetch ? new Date(instance.last_instagram_fetch) : new Date(0);
  if (credentials.instagram && profile.instagram_handle && (now.getTime() - igLastFetch.getTime() > FIFTEEN_MINS)) {
    const igPosts = await fetchInstagramPosts(profile.instagram_handle, credentials.instagram);
    allPosts.push(...igPosts);
    
    // Persist posts (tenant_id scoped)
    for (const post of igPosts) {
      await sql`
        INSERT INTO public.social_posts (tenant_id, platform, external_id, content, published_at)
        VALUES (${tenantId}, 'instagram', ${post.id}, ${post.content}, ${post.timestamp})
        ON CONFLICT (tenant_id, platform, external_id) DO UPDATE SET content = EXCLUDED.content
      `;
    }
    
    await sql`UPDATE public.chioma_instances SET last_instagram_fetch = NOW() WHERE tenant_id = ${tenantId}`;
  }

  // TikTok Discovery
  const ttLastFetch = instance.last_tiktok_fetch ? new Date(instance.last_tiktok_fetch) : new Date(0);
  if (credentials.tiktok && profile.tiktok_handle && (now.getTime() - ttLastFetch.getTime() > FIFTEEN_MINS)) {
    const ttPosts = await fetchTikTokPosts(profile.tiktok_handle, credentials.tiktok);
    allPosts.push(...ttPosts);

    // Persist posts (tenant_id scoped)
    for (const post of ttPosts) {
      await sql`
        INSERT INTO public.social_posts (tenant_id, platform, external_id, content, published_at)
        VALUES (${tenantId}, 'tiktok', ${post.id}, ${post.content}, ${post.timestamp})
        ON CONFLICT (tenant_id, platform, external_id) DO UPDATE SET content = EXCLUDED.content
      `;
    }

    await sql`UPDATE public.chioma_instances SET last_tiktok_fetch = NOW() WHERE tenant_id = ${tenantId}`;
  }

  return allPosts;
}

/**
 * Summarization Job: Synthesis of tenant-specific knowledge.
 * Reads social_posts WHERE tenant_id = X and writes to tenant_knowledge.
 */
export async function updateTenantKnowledge(sql: any, tenantId: string): Promise<void> {
  const posts = await sql`
    SELECT platform, content, published_at 
    FROM public.social_posts 
    WHERE tenant_id = ${tenantId} 
    ORDER BY published_at DESC 
    LIMIT 20
  `;

  if (posts.length === 0) return;

  const socialPosts = posts.map((p: any) => ({
    source: p.platform as any,
    content: p.content,
    timestamp: p.published_at.toISOString(),
    id: ""
  }));

  const draft = await generateBusinessDraft(socialPosts);
  const businessContext = formatDraftForEmployer(draft);

  await sql`
    INSERT INTO public.tenant_knowledge (tenant_id, business_context, last_updated_at)
    VALUES (${tenantId}, ${businessContext}, NOW())
    ON CONFLICT (tenant_id) DO UPDATE SET 
      business_context = EXCLUDED.business_context,
      last_updated_at = NOW()
  `;
}

export async function generateBusinessDraft(
  linkContents: string[] | SocialPost[]
): Promise<BusinessDraft> {
  const combinedText = Array.isArray(linkContents) && typeof linkContents[0] !== 'string'
    ? (linkContents as SocialPost[]).map(p => `[${p.source.toUpperCase()}] ${p.timestamp}: ${p.content}`).join("\n\n---\n\n")
    : (linkContents as string[]).join("\n\n---\n\n");

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

