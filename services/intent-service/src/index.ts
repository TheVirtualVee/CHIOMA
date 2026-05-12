import { EVENT_TYPES, createFollowupEvent, type EventBus } from "@chioma/core";
import { createConsoleLogger, createSafeHandler, metrics } from "@chioma/infrastructure";

/** contract: IntentService */
export function registerIntentService(bus: EventBus): void {
  const logger = createConsoleLogger("intent-service");
  
  bus.subscribe(
    EVENT_TYPES.MESSAGE_RECEIVED,
    createSafeHandler(
      async (event) => {
        const text = (event.payload as { text?: string } | null)?.text ?? "";
        const { correlationId, tenantId, id: causationId } = event;
        
        metrics.emit("intent_classification_started", { 
          tenantId, 
          correlationId, 
          causationId,
          service: "intent-service" 
        });

        await bus.publish(
          createFollowupEvent(
            EVENT_TYPES.INTENT_CLASSIFIED,
            { primaryIntent: text.length > 0 ? "customer_message" : "empty", text },
            event
          )
        );
      },
      { service: "intent-service", operation: "CLASSIFY_INTENT", logger }
    )
  );
}
