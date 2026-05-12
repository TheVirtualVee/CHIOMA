import { EVENT_TYPES, type Commitment, type EventBus } from "@chioma/core";
import { createConsoleLogger, devEvent } from "@chioma/infrastructure";

/**
 * Detects conservative degradation signals. Emits RELIABILITY_ALERT — does not mutate commitments directly.
 */
export function registerReliabilityEngine(bus: EventBus): void {
  const log = createConsoleLogger("reliability-engine");
  bus.subscribe(EVENT_TYPES.COMMITMENT_CREATED, async (e) => {
    const c = (e.payload as { commitment?: Commitment } | null)?.commitment;
    if (!c) return;
    if (c.severity === "CRITICAL" || c.severity === "HIGH") {
      if (c.ambiguityScore > 0.45 || c.confidenceScore < 0.88) {
        log.warn("RELIABILITY_DEGRADATION", { commitmentId: c.id, tenantId: e.tenantId });
        await bus.publish(
          devEvent(
            `rel_${c.id}`,
            EVENT_TYPES.RELIABILITY_ALERT,
            {
              code: "CHI-REL-001",
              mode: "conservative",
              hints: ["faster_escalation", "no_upsell", "request_clarification_bias"],
              commitmentId: c.id,
            },
            e.correlationId,
            e.id,
            e.tenantId,
          ),
        );
      }
    }
  });
}
