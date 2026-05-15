import { randomUUID } from "node:crypto";
import { generateStaffReply } from "../response-service/index.js";
import { BusinessDailyState } from "../../core/contracts/index.js";

/**
 * Business Reality Synchronization Engine (BRSE)
 * Purpose: Converts messy owner input into structured, locked operational truth.
 */
export async function proposeRealityUpdate(
  sql: any,
  tenantId: string,
  messyInput: string,
  config: { apiKey: string; provider: string }
): Promise<{ proposal: BusinessDailyState; response: string }> {
  
  // 1. LLM STRUCTURING LAYER
  // We use the staff-loop cognition to extract reality from the owner's message.
  const extractionPrompt = `
    TASK: Convert the owner's messy business update into a structured DailyBusinessSnapshot.
    
    INPUT: "${messyInput}"
    
    OUTPUT FORMAT (JSON):
    {
      "inventory": [{ "item": string, "count": number, "price": number }],
      "promotions": string[],
      "active_rules": string[]
    }
    
    CRITICAL: Extract only what is explicitly mentioned. If count or price is missing, use null.
  `;

  // Note: We use generateStaffReply for simplicity here, but in prod we'd have a specific extraction prompt.
  const cognitionResult = await generateStaffReply(
    extractionPrompt,
    "You are the Business Reality Extraction Kernel.",
    { 
      business_name: "SYSTEM", 
      tone_profile: "formal", 
      response_style: "concise",
      escalation_contact: "",
      working_hours: "",
      version: 1 
    },
    config
  );

  const proposal: BusinessDailyState = JSON.parse(cognitionResult.response);
  proposal.effective_date = new Date().toISOString();

  // 2. STORE AS PROPOSED
  const correlationId = `sync_${randomUUID()}`;
  await sql`
    INSERT INTO business_snapshots (tenant_id, snapshot_data, confidence_score, status, correlation_id)
    VALUES (${tenantId}, ${sql.json(proposal)}, ${cognitionResult.confidence}, 'PROPOSED', ${correlationId})
  `;

  // 3. FORMAT CONFIRMATION RESPONSE
  const inventoryLines = proposal.inventory
    .map(i => `• ${i.count} ${i.item} (₦${i.price.toLocaleString()})`)
    .join("\n");
  
  const promoLines = proposal.promotions.length > 0 
    ? `\nPromotions:\n${proposal.promotions.map(p => `• ${p}`).join("\n")}`
    : "";

  const response = `Here is your updated business state for today:\n\n${inventoryLines}${promoLines}\n\nShould I lock this in for today’s operations? (Send /confirm to activate)`;

  return { proposal, response };
}

export async function lockReality(sql: any, tenantId: string): Promise<string> {
  const [latest] = await sql`
    SELECT id, snapshot_data FROM business_snapshots 
    WHERE tenant_id = ${tenantId} AND status = 'PROPOSED'
    ORDER BY created_at DESC LIMIT 1
  `;

  if (!latest) return "I don't have a pending update to confirm. Send me a briefing first!";

  // Supersede old locked states
  await sql`UPDATE business_snapshots SET status = 'SUPERSEDED' WHERE tenant_id = ${tenantId} AND status = 'LOCKED'`;
  
  // Lock the new state
  await sql`
    UPDATE business_snapshots 
    SET status = 'LOCKED', locked_at = NOW() 
    WHERE id = ${latest.id}
  `;

  // Update the main profile sync time
  await sql`
    UPDATE employer_profiles 
    SET last_sync_at = NOW(), version = version + 1
    WHERE tenant_id = ${tenantId}
  `;
  
  // Sync current facts for fast-path retrieval in staff-loop
  await sql`
    INSERT INTO business_facts (tenant_id, key, value)
    VALUES (${tenantId}, 'daily_inventory', ${sql.json(latest.snapshot_data.inventory)})
    ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value
  `;

  return "Perfect! I've locked in today's business reality. I am now using this state to manage your customer inquiries. 🚀";
}
