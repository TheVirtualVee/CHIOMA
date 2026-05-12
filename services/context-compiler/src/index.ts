import { EVENT_TYPES, type EventBus } from "@chioma/core";
import { createConsoleLogger, devEvent } from "@chioma/infrastructure";
import { buildHybridRetrievalHints } from "./context/retrieval-scoring.js";
import { summarizeWarmColdOnly } from "./context/summarization-engine.js";

export function registerContextCompiler(bus: EventBus): void {
  const log = createConsoleLogger("context-compiler");
  bus.subscribe(EVENT_TYPES.INTENT_CLASSIFIED, async (e) => {
    const warmColdSummary = summarizeWarmColdOnly({
      warmInteractions: [],
      coldArchive: [],
      tokenBudget: 4096,
    });
    const retrieval = buildHybridRetrievalHints({
      semanticTopK: 100,
      symbolicCommitmentIds: [],
      customerId: null,
      businessEntityIds: [],
    });
    log.info("CONTEXT_SNAPSHOT_BUILT", { correlationId: e.correlationId });
    await bus.publish(
      devEvent(
        `ctx_${e.id}`,
        EVENT_TYPES.MEMORY_UPDATED,
        {
          kind: "CONTEXT_SNAPSHOT",
          safetyLayer: "stub-pass",
          activeConversation: [e.payload],
          rankedCustomerMemory: [],
          businessFacts: [],
          warmColdSummary,
          retrieval,
        },
        e.correlationId,
        e.id,
        e.tenantId,
      ),
    );
  });
}