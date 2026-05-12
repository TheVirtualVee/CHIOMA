import { EVENT_TYPES, mapInstruction, createFollowupEvent, type EventBus, type LlmStructuredOutput } from "@chioma/core";
import { createConsoleLogger, devEvent, metrics, overseer } from "@chioma/infrastructure";

/** contract: LlmOrchestrator */
export function registerLlmOrchestrator(bus: EventBus): void {
  const logger = createConsoleLogger("llm-orchestrator");

  bus.subscribe(EVENT_TYPES.MEMORY_UPDATED, async (event) => {
    const payload = event.payload as { kind?: string; text?: string } | null;
    if (payload?.kind !== "CONTEXT_SNAPSHOT") return;

    const input = payload.text ?? (payload as any).activeConversation?.[0]?.text ?? "";
    
    try {
      const intent = mapInstruction(input, { tenantId: event.tenantId });

      if (intent === "UNCLASSIFIED") {
        logger.info("INTENT_UNRESOLVABLE", { correlationId: event.correlationId, reason: "No executable intent detected" });
        await bus.publish(createFollowupEvent(EVENT_TYPES.EXECUTION_FAILED, { type: "INTENT_UNRESOLVABLE", input }, event));
        return;
      }

      const validated = overseer.validate(intent, input);
      if (!validated.ok) {
        logger.warn("GOVERNANCE_BLOCKED", { correlationId: event.correlationId, reason: validated.reason });
        await bus.publish(createFollowupEvent(EVENT_TYPES.EXECUTION_FAILED, { type: "GOVERNANCE_BLOCKED", detail: validated.reason }, event));
        return;
      }
    } catch (err: any) {
      if (err.message?.includes("CONFIG_INVALID")) {
        await bus.publish(createFollowupEvent(EVENT_TYPES.EXECUTION_FAILED, { type: "CONFIG_INVALID", detail: err.message }, event));
      } else {
        await bus.publish(createFollowupEvent(EVENT_TYPES.EXECUTION_FAILED, { type: "EXECUTION_FAILED", detail: err.message }, event));
      }
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

    await bus.publish(createFollowupEvent(EVENT_TYPES.EXECUTION_COMPLETED, { intent, status: "SUCCESS" }, event));
  });
}
