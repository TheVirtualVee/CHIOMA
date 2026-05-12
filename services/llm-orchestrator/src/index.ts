import { EVENT_TYPES, type EventBus, type LlmStructuredOutput } from "@chioma/core";
import { createConsoleLogger, devEvent } from "@chioma/infrastructure";

export function registerLlmOrchestrator(bus: EventBus): void {
  const log = createConsoleLogger("llm-orchestrator");
  bus.subscribe(EVENT_TYPES.MEMORY_UPDATED, async (e) => {
    const p = e.payload as { kind?: string } | null;
    if (p?.kind !== "CONTEXT_SNAPSHOT") return;

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

    log.info("LLM_COMPLETED", { correlationId: e.correlationId });
    await bus.publish(
      devEvent(
        `llm_${e.id}`,
        EVENT_TYPES.MEMORY_UPDATED,
        { kind: "LLM_COMPLETED", structured },
        e.correlationId,
        e.id,
        e.tenantId,
      ),
    );
  });
}
