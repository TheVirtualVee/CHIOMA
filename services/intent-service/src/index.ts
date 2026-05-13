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
        let urgencyScore = 0;
        let urgencyReason = "";

        try {
          const result = await llm.complete({
            systemPrompt: `Classify user intent and urgency.
Intents: [customer_message, inquiry, escalation, empty]
Urgency Scale: 0 to 10 (10 is extremely urgent revenue risk)
Urgency Reasons: [bulk_order, payment_intent, follow_up, emotional_escalation, high_purchase_intent, none]

Return JSON: { "intent": "label", "urgency": number, "reason": "label" }`,
            prompt: text,
            temperature: 0
          });
          
          const parsed = JSON.parse(result.content.trim());
          intent = parsed.intent || "customer_message";
          urgencyScore = parsed.urgency || 0;
          urgencyReason = parsed.reason || "none";

        } catch (err) {
          logger.warn("INTENT_FALLBACK", { error: String(err) });
          intent = text.length > 0 ? "customer_message" : "empty";
        }

        await bus.publish(
          createFollowupEvent(
            EVENT_TYPES.INTENT_CLASSIFIED,
            { primaryIntent: intent, text, urgencyScore, urgencyReason },
            event
          )
        );

        if (urgencyScore >= 7) {
          await bus.publish(
            createFollowupEvent(
              EVENT_TYPES.ESCALATION_TRIGGERED,
              { reason: urgencyReason, score: urgencyScore, originalText: text },
              event
            )
          );
          logger.info("ESCALATION_AUTO_TRIGGERED", { tenantId, urgencyScore, urgencyReason });
        }
      },
      { service: "intent-service", operation: "CLASSIFY_INTENT", logger }
    )
  );
}
