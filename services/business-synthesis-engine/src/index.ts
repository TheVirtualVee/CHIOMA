import { EVENT_TYPES, type BusinessSynthesisProposal, type EventBus } from "@chioma/core";
import { createConsoleLogger, devEvent } from "@chioma/infrastructure";

/**
 * Publishes a non-authoritative synthesis proposal. NEVER mutates business state.
 * Owner confirmation must emit BUSINESS_STATE_OWNER_CONFIRMED before projections apply facts.
 */
export async function publishBusinessSynthesisProposal(
  bus: EventBus,
  args: { correlationId: string; causationId: string | null; tenantId?: string },
): Promise<void> {
  const log = createConsoleLogger("business-synthesis-engine");
  const now = new Date().toISOString();
  const proposal: BusinessSynthesisProposal = {
    business_name: "Unknown (stub)",
    services: [],
    products: [],
    pricing_detected: [],
    operating_hours: {},
    languages_detected: [],
    tone_inference: {},
    escalation_candidates: [],
    confidence_scores: { overall: 0.2 },
    provenance: [
      {
        fact: "stub extraction",
        source_type: "demo",
        source_url: "https://example.invalid",
        confidence: 0.2,
        verified_by_owner: false,
        extracted_at: now,
      },
    ],
  };
  log.info("BUSINESS_SYNTHESIS_PROPOSED", { correlationId: args.correlationId });
  await bus.publish(
    devEvent(
      `syn_${args.correlationId}`,
      EVENT_TYPES.BUSINESS_SYNTHESIS_PROPOSED,
      { proposal },
      args.correlationId,
      args.causationId,
      args.tenantId,
    ),
  );
}

export function registerBusinessSynthesisEngine(bus: EventBus): void {
  const log = createConsoleLogger("business-synthesis-engine");
  bus.subscribe(EVENT_TYPES.BUSINESS_SYNTHESIS_PROPOSED, async (e) => {
    log.info("SYNTHESIS_AUDIT", { id: e.id, tenantId: e.tenantId });
  });
}
