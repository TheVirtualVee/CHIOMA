import { EVENT_TYPES, mapInstruction, type EventBus, type LlmStructuredOutput } from "@chioma/core";
import { createConsoleLogger, devEvent, metrics, overseer } from "@chioma/infrastructure";

/** contract: LlmOrchestrator */
export function registerLlmOrchestrator(bus: EventBus): void {
  const logger = createConsoleLogger("llm-orchestrator");

  bus.subscribe(EVENT_TYPES.MEMORY_UPDATED, async (event) => {
    const payload = event.payload as { kind?: string; text?: string } | null;
    if (payload?.kind !== "CONTEXT_SNAPSHOT") return;

    const input = payload.text ?? "";
    const intent = mapInstruction(input);

    if (intent === "NO_OP") {
      logger.info("CEM_NO_OP", { correlationId: event.correlationId, reason: "No executable intent detected" });
      return;
    }

    const validated = overseer.validate(intent, input);
    if (!validated.ok) {
      logger.warn("CEM_VALIDATION_FAILURE", { correlationId: event.correlationId, reason: validated.reason });
      return;
    }

    const { tenantId, correlationId, id: causationId } = event;

    const structured: LlmStructuredOutput = {
      response: "Thanks — I can help with that. No promises recorded yet.",
      intent: "assist",
      proposed_commitments: [
        {
          origin: "inferred",
          type: "follow_up",
          severity: "MEDIUM",
          ambiguityScore: 0.25,
          confidenceScore: 0.86,
          deadlineIso: new Date(Date.now() + 86400_000).toISOString(),
          businessSupports: true,
          feasibilityConfirmed: true,
        },
      ],
      confidence: 0.86,
    };

    logger.info("LLM_COMPLETED", { correlationId, tenantId, causationId });
    metrics.emit("llm_generation_completed", { correlationId, tenantId, causationId, service: "llm-orchestrator" });

    await bus.publish(
      devEvent(
        `llm_${event.id}`,
        EVENT_TYPES.MEMORY_UPDATED,
        { kind: "LLM_COMPLETED", structured },
        correlationId,
        event.id,
        tenantId,
      ),
    );
  });
}
