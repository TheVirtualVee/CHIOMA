import { EVENT_TYPES, type EventBus, type LlmStructuredOutput } from "@chioma/core";
import { createConsoleLogger, devEvent } from "@chioma/infrastructure";

export function registerDeliveryService(bus: EventBus): void {
  const log = createConsoleLogger("delivery-service");
  bus.subscribe(EVENT_TYPES.MEMORY_UPDATED, async (e) => {
    const p = e.payload as { kind?: string; structured?: LlmStructuredOutput } | null;
    if (p?.kind !== "LLM_COMPLETED" || !p.structured) return;

    log.info("RESPONSE_SENT", { correlationId: e.correlationId });
    await bus.publish(
      devEvent(
        `del_${e.id}`,
        EVENT_TYPES.RESPONSE_SENT,
        { channel: "whatsapp", text: p.structured.response },
        e.correlationId,
        e.id,
        e.tenantId,
      ),
    );
  });
}
