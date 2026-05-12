import { EVENT_TYPES, type Commitment, type EventBus } from "@chioma/core";
import { createConsoleLogger, devEvent, metrics } from "@chioma/infrastructure";

/** contract: ReliabilityEngine */
export function registerReliabilityEngine(bus: EventBus): void {
  const logger = createConsoleLogger("reliability-engine");

  bus.subscribe(EVENT_TYPES.COMMITMENT_CREATED, async (event) => {
    const commitment = (event.payload as { commitment?: Commitment } | null)?.commitment;
    if (!commitment) return;

    const { tenantId, correlationId, id: causationId } = event;

    if (commitment.severity === "CRITICAL" || commitment.severity === "HIGH") {
      if (commitment.ambiguityScore > 0.45 || commitment.confidenceScore < 0.88) {
        
        logger.warn("RELIABILITY_DEGRADATION_DETECTED", { commitmentId: commitment.id, tenantId, causationId });
        metrics.emit("reliability_degradation", { commitmentId: commitment.id, tenantId, causationId, service: "reliability-engine" });

        await bus.publish(
          devEvent(
            `rel_${commitment.id}`,
            EVENT_TYPES.RELIABILITY_ALERT,
            {
              code: "CHI-REL-001",
              mode: "conservative",
              hints: ["faster_escalation", "request_clarification_bias"],
              commitmentId: commitment.id,
            },
            correlationId,
            eventId,
            tenantId,
          ),
        );
      }
    }
  });
}
