import { randomUUID } from "node:crypto";
import { generateStaffReply } from "../response-service/index.js";
import { BusinessDailyState } from "../../core/contracts/index.js";

/**
 * INTERNAL LLM PROPOSAL TYPE
 * (DO NOT POLLUTE CORE CONTRACTS)
 */
type BusinessRealityProposal = {
  inventory?: Array<{
    item: string;
    count: number | null;
    price: number | null;
  }>;
  promotions?: string[];
  active_rules?: string[];
};

/**
 * Business Reality Synchronization Engine (BRSE)
 */
export async function proposeRealityUpdate(
  sql: any,
  tenantId: string,
  messyInput: string,
  config: { apiKey: string; provider: string }
): Promise<{ proposal: BusinessDailyState; response: string }> {

  const extractionPrompt = `
TASK: Convert owner's input into structured business reality JSON.

INPUT: "${messyInput}"

OUTPUT FORMAT:
{
  "inventory": [{ "item": string, "count": number|null, "price": number|null }],
  "promotions": string[],
  "active_rules": string[]
}

RULES:
- Only extract explicit information
- Use null if missing numeric values
- Return valid JSON only
`;

  const cognitionResult = await generateStaffReply(
    extractionPrompt,
    "You are the Business Reality Extraction Kernel.",
    {
      business_name: "SYSTEM",
      tone_profile: "formal",
      response_style: "helpful",
      escalation_contact: "",
      working_hours: "",
      version: 1
    },
    config
  );

  const raw: BusinessRealityProposal = JSON.parse(cognitionResult.response);

  const proposal: BusinessDailyState = {
    tenantId,
    snapshotId: randomUUID(),
    facts: {
      inventory: raw.inventory ?? [],
      promotions: raw.promotions ?? [],
      active_rules: raw.active_rules ?? []
    },
    lockedAt: new Date().toISOString()
  };

  const correlationId = `sync_${randomUUID()}`;

  await sql`
    INSERT INTO business_snapshots (
      tenant_id, snapshot_data, confidence_score, status, correlation_id
    )
    VALUES (
      ${tenantId},
      ${sql.json(proposal)},
      ${cognitionResult.confidence},
      'PROPOSED',
      ${correlationId}
    )
  `;

  const inventoryLines = (raw.inventory ?? [])
    .map(i => `• ${i.count ?? 0} ${i.item} (₦${i.price ?? 0})`)
    .join("\n");

  const promoLines =
    (raw.promotions ?? []).length > 0
      ? `\nPromotions:\n${raw.promotions!.map(p => `• ${p}`).join("\n")}`
      : "";

  const response =
    `Here is your updated business state for today:\n\n` +
    `${inventoryLines}${promoLines}\n\n` +
    `Should I lock this in for today’s operations? (Send /confirm to activate)`;

  return { proposal, response };
}

export async function lockReality(sql: any, tenantId: string): Promise<string> {
  const [latest] = await sql`
    SELECT id, snapshot_data
    FROM business_snapshots
    WHERE tenant_id = ${tenantId} AND status = 'PROPOSED'
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (!latest) {
    return "I don't have a pending update to confirm. Send me a briefing first!";
  }

  await sql`
    UPDATE business_snapshots
    SET status = 'SUPERSEDED'
    WHERE tenant_id = ${tenantId} AND status = 'LOCKED'
  `;

  await sql`
    UPDATE business_snapshots
    SET status = 'LOCKED', locked_at = NOW()
    WHERE id = ${latest.id}
  `;

  await sql`
    UPDATE employer_profiles
    SET last_sync_at = NOW(),
        version = version + 1
    WHERE tenant_id = ${tenantId}
  `;

  await sql`
    INSERT INTO business_facts (tenant_id, key, value)
    VALUES (${tenantId}, 'daily_inventory', ${sql.json(latest.snapshot_data.facts?.inventory ?? [])})
    ON CONFLICT (tenant_id, key)
    DO UPDATE SET value = EXCLUDED.value
  `;

  return "Perfect! I've locked in today's business reality. 🚀";
}