import { EVENT_TYPES, type BusinessTrainingProposal, type EventBus } from "@chioma/core";
import { createConsoleLogger, devEvent } from "@chioma/infrastructure";

/** Conversational policy extraction — non-authoritative until owner confirms. */
export async function publishBusinessTrainingProposal(
  bus: EventBus,
  args: { correlationId: string; causationId: string | null; tenantId?: string },
): Promise<void> {
  const log = createConsoleLogger("business-training-engine");
  const proposal: BusinessTrainingProposal = {
    operational_rules: ["Never confirm payment without human approval (stub)"],
    escalation_policies: [],
    forbidden_promises: ["guaranteed delivery time without inventory check"],
    upsell_preferences: [],
    tone_calibration: { formality: "neutral" },
    multilingual_boundaries: ["default: business language only until configured"],
  };
  log.info("BUSINESS_TRAINING_PROPOSED", { correlationId: args.correlationId });
  await bus.publish(
    devEvent(
      `trn_${args.correlationId}`,
      EVENT_TYPES.BUSINESS_TRAINING_PROPOSED,
      { proposal },
      args.correlationId,
      args.causationId,
      args.tenantId,
    ),
  );
}

export function registerBusinessTrainingEngine(bus: EventBus): void {
  const log = createConsoleLogger("business-training-engine");
  bus.subscribe(EVENT_TYPES.BUSINESS_TRAINING_PROPOSED, async (e) => {
    log.info("TRAINING_AUDIT", { id: e.id, tenantId: e.tenantId });
  });
}
