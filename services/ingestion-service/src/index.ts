import { EVENT_TYPES, type EventBus } from "@chioma/core";
import { createConsoleLogger, devEvent, metrics } from "@chioma/infrastructure";

/** contract: IngestionService */
export function createIngestionApi(bus: EventBus) {
  const logger = createConsoleLogger("ingestion-service");
  return {
    async receiveWhatsAppText(text: string, correlationId: string, tenantId: string): Promise<void> {
      const id = `msg_${correlationId}`;
      const causationId = null;

      logger.info("MESSAGE_RECEIVED", { correlationId, id, tenantId });
      metrics.emit("message_ingested", { correlationId, tenantId, service: "ingestion-service" });

      await bus.publish(
        devEvent(id, EVENT_TYPES.MESSAGE_RECEIVED, { channel: "whatsapp", text }, correlationId, causationId, tenantId),
      );
    },
  };
}

export function registerIngestionService(_bus: EventBus): void {
  // side-effect: service registration
}
