import { EVENT_TYPES, type EventBus } from "@chioma/core";
import { createConsoleLogger, metrics } from "@chioma/infrastructure";

/** contract: EscalationService */
export function registerEscalationService(bus: EventBus): void {
  const logger = createConsoleLogger("escalation-service");

  bus.subscribe(EVENT_TYPES.ESCALATION_TRIGGERED, async (event) => {
    const { correlationId, tenantId, id: causationId, payload } = event;
    logger.warn("ESCALATION_TRIGGERED", { correlationId, tenantId, causationId, payload });
    metrics.emit("escalation_triggered", { correlationId, tenantId, causationId, service: "escalation-service" });
  });

  bus.subscribe(EVENT_TYPES.RELIABILITY_ALERT, async (event) => {
    const { correlationId, tenantId, id: causationId, payload } = event;
    logger.warn("RELIABILITY_ALERT", { correlationId, tenantId, causationId, payload });
    metrics.emit("reliability_alert_received", { correlationId, tenantId, causationId, service: "escalation-service" });
  });
}
