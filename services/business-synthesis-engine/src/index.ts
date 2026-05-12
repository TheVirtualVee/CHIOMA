import { EVENT_TYPES, type BusinessSynthesisProposal, type EventBus } from "@chioma/core";
import { createConsoleLogger, devEvent, metrics } from "@chioma/infrastructure";

/** contract: BusinessSynthesisEngine */
export async function publishBusinessSynthesisProposal(
  bus: EventBus,
  args: { correlationId: string; causationId: string | null; tenantId: string },
): Promise<void> {
  const logger = createConsoleLogger("business-synthesis-engine");
  const now = new Date().toISOString();
  
  const proposal: BusinessSynthesisProposal = {
    business_name: "Unidentified Entity",
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
        fact: "initial extraction",
        source_type: "inference",
        source_url: "",
        confidence: 0.2,
        verified_by_owner: false,
        extracted_at: now,
      },
    ],
  };

  const { correlationId, causationId, tenantId } = args;

  logger.info("BUSINESS_SYNTHESIS_PROPOSED", { correlationId, tenantId });
  metrics.emit("business_synthesis_proposed", { correlationId, tenantId, service: "business-synthesis-engine" });

  await bus.publish(
    devEvent(
      `syn_${correlationId}`,
      EVENT_TYPES.BUSINESS_SYNTHESIS_PROPOSED,
      { proposal },
      correlationId,
      causationId,
      tenantId,
    ),
  );
}

export function registerBusinessSynthesisEngine(bus: EventBus): void {
  const logger = createConsoleLogger("business-synthesis-engine");
  bus.subscribe(EVENT_TYPES.BUSINESS_SYNTHESIS_PROPOSED, async (event) => {
    logger.info("SYNTHESIS_AUDIT", { id: event.id, tenantId: event.tenantId, correlationId: event.correlationId });
  });
}
