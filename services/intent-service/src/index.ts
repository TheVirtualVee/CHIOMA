import { EVENT_TYPES, type EventBus } from "@chioma/core";
import { createConsoleLogger, devEvent } from "@chioma/infrastructure";

export function registerIntentService(bus: EventBus): void {
  const log = createConsoleLogger("intent-service");
  bus.subscribe(EVENT_TYPES.MESSAGE_RECEIVED, async (e) => {
    const text = (e.payload as { text?: string } | null)?.text ?? "";
    log.info("INTENT_CLASSIFIED", { correlationId: e.correlationId, textLen: text.length });
    await bus.publish(
      devEvent(
        `intent_${e.id}`,
        EVENT_TYPES.INTENT_CLASSIFIED,
        { primaryIntent: text.length > 0 ? "customer_message" : "empty", text },
        e.correlationId,
        e.id,
        e.tenantId,
      ),
    );
  });
}
