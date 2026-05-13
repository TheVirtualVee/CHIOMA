import { 
  EVENT_TYPES, 
  type EventBus, 
  type DomainEvent 
} from "@chioma/core";
import { createConsoleLogger } from "@chioma/infrastructure";
import type postgres from "postgres";

const logger = createConsoleLogger("operational-intelligence");

export function registerIntelligenceService(bus: EventBus, _sql: postgres.Sql) {
  
  // Example: Listen for ONBOARDING_COMPLETED to send a welcome summary
  bus.subscribe(EVENT_TYPES.ONBOARDING_COMPLETED, async (event: DomainEvent) => {
    const { tenantId } = event;
    logger.info("ONBOARDING_COMPLETED_INTELLIGENCE", { tenantId });
  });

  // Example: Detect high-value intent that wasn't responded to by human
  bus.subscribe(EVENT_TYPES.ESCALATION_TRIGGERED, async (_event: DomainEvent) => {
    // Record this for the morning digest
  });
}

/** 
 * contract: generateDailyDigest
 * Aggregates operational truth into a human-readable revenue report.
 */
export async function generateDailyDigest(tenantId: string, sql: postgres.Sql): Promise<string> {
  // 1. Query events from the last 24h
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  
  const events = await sql`
    SELECT type, payload FROM core.events 
    WHERE tenant_id = ${tenantId} AND created_at > ${yesterday}
  `;

  // 2. Aggregate metrics
  const customerMessages = events.filter(e => e.type === EVENT_TYPES.MESSAGE_RECEIVED).length;
  const escalations = events.filter(e => e.type === EVENT_TYPES.ESCALATION_TRIGGERED).length;
  
  // 3. Estimate Revenue Risk (Heuristic)
  let revenueRisk = 0;
  events.forEach(e => {
    if (e.type === EVENT_TYPES.ESCALATION_TRIGGERED && e.payload.reason === 'bulk_order') {
      revenueRisk += 50000; // Approx 50k NGN per bulk order risk
    }
  });

  // 4. Format Output
  return `Yesterday:
* ${customerMessages} customers reached out
* ${escalations} urgent escalations triggered
* Estimated revenue risk: ₦${revenueRisk.toLocaleString()}

I'm protecting your business while you're away.`;
}
