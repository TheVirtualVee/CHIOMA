import { EVENT_TYPES, type BusinessTrainingProposal, type EventBus } from "@chioma/core";
import { createConsoleLogger, devEvent, metrics } from "@chioma/infrastructure";

/** contract: BusinessTrainingEngine */
export async function publishBusinessTrainingProposal(
  bus: EventBus,
  args: { correlationId: string; causationId: string | null; tenantId: string },
): Promise<void> {
  const logger = createConsoleLogger("business-training-engine");
  
  const proposal: BusinessTrainingProposal = {
    operational_rules: ["Verify intent clarity before commitment"],
    escalation_policies: [],
    forbidden_promises: ["guaranteed delivery time without inventory check"],
    upsell_preferences: [],
    tone_calibration: { formality: "neutral" },
    multilingual_boundaries: ["default: business language only until configured"],
  };

  const { correlationId, causationId, tenantId } = args;

  logger.info("BUSINESS_TRAINING_PROPOSED", { correlationId, tenantId });
  metrics.emit("business_training_proposed", { correlationId, tenantId, service: "business-training-engine" });

  await bus.publish(
    devEvent(
      `trn_${correlationId}`,
      EVENT_TYPES.BUSINESS_TRAINING_PROPOSED,
      { proposal },
      correlationId,
      causationId,
      tenantId,
    ),
  );

  await bus.publish(
    devEvent(
      `done_${correlationId}`,
      EVENT_TYPES.EXECUTION_COMPLETED,
      { service: "business-training-engine", action: "PROPOSAL_PUBLISHED" },
      correlationId,
      causationId,
      tenantId,
    )
  );
}

export function registerBusinessTrainingEngine(bus: EventBus): void {
  const logger = createConsoleLogger("business-training-engine");
  bus.subscribe(EVENT_TYPES.BUSINESS_TRAINING_PROPOSED, async (event) => {
    logger.info("TRAINING_AUDIT", { id: event.id, tenantId: event.tenantId, correlationId: event.correlationId });
  });
}
