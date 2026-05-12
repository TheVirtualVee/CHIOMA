import { EVENT_TYPES, type EventBus } from "@chioma/core";
import { createConsoleLogger, devEvent } from "@chioma/infrastructure";

export function createIngestionApi(bus: EventBus) {
  const log = createConsoleLogger("ingestion-service");
  return {
    async receiveWhatsAppText(text: string, correlationId: string, tenantId?: string): Promise<void> {
      const id = `msg_${correlationId}`;
      log.info("MESSAGE_RECEIVED", { correlationId, id, tenantId });
      await bus.publish(
        devEvent(id, EVENT_TYPES.MESSAGE_RECEIVED, { channel: "whatsapp", text }, correlationId, null, tenantId),
      );
    },
  };
}
