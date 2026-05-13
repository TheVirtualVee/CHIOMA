import { EVENT_TYPES, createFollowupEvent, type EventBus } from "@chioma/core";
import { createConsoleLogger, createSafeHandler, metrics, createLlmProviderFromEnv } from "@chioma/infrastructure";

/** contract: IntentService */
export function registerIntentService(bus: EventBus): void {
  const logger = createConsoleLogger("intent-service");
  const llm = createLlmProviderFromEnv();
  
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

        let intent = "unknown";
        try {
          const result = await llm.complete({
            systemPrompt: "Classify user intent into: [customer_message, inquiry, escalation, empty]. Return ONLY the label.",
            prompt: text,
            temperature: 0
          });
          intent = result.content.trim().toLowerCase();
        } catch (err) {
          logger.warn("INTENT_FALLBACK", { error: String(err) });
          intent = text.length > 0 ? "customer_message" : "empty";
        }

        await bus.publish(
          createFollowupEvent(
            EVENT_TYPES.INTENT_CLASSIFIED,
            { primaryIntent: intent, text },
            event
          )
        );
      },
      { service: "intent-service", operation: "CLASSIFY_INTENT", logger }
    )
  );
}
