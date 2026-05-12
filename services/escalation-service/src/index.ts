import { EVENT_TYPES, type EventBus } from "@chioma/core";
import { createConsoleLogger } from "@chioma/infrastructure";

export function registerEscalationService(bus: EventBus): void {
  const log = createConsoleLogger("escalation-service");
  bus.subscribe(EVENT_TYPES.ESCALATION_TRIGGERED, async (e) => {
    log.warn("ESCALATION_TRIGGERED", { correlationId: e.correlationId, payload: e.payload });
  });
  bus.subscribe(EVENT_TYPES.RELIABILITY_ALERT, async (e) => {
    log.warn("RELIABILITY_ALERT", { correlationId: e.correlationId, payload: e.payload });
  });
}
