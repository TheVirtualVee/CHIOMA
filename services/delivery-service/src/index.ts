import { EVENT_TYPES, type EventBus, type LlmStructuredOutput } from "@chioma/core";
import { createConsoleLogger, devEvent, metrics } from "@chioma/infrastructure";

/** contract: DeliveryService */
export function registerDeliveryService(bus: EventBus): void {
  const logger = createConsoleLogger("delivery-service");

  bus.subscribe(EVENT_TYPES.MEMORY_UPDATED, async (event) => {
    const payload = event.payload as { kind?: string; structured?: LlmStructuredOutput } | null;
    if (payload?.kind !== "LLM_COMPLETED" || !payload.structured) return;

    const { tenantId, correlationId, id: causationId } = event;

    logger.info("RESPONSE_SENT", { correlationId, tenantId, causationId });
    metrics.emit("message_delivered", { correlationId, tenantId, causationId, service: "delivery-service" });

    await bus.publish(
      devEvent(
        `del_${event.id}`,
        EVENT_TYPES.RESPONSE_SENT,
        { channel: "whatsapp", text: payload.structured.response },
        correlationId,
        event.id,
        tenantId,
      ),
    );
  });
}
