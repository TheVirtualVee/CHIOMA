import { EVENT_TYPES, type EventBus } from "@chioma/core";
import { createConsoleLogger, devEvent, metrics } from "@chioma/infrastructure";
import { buildHybridRetrievalHints } from "./context/retrieval-scoring.js";
import { summarizeWarmColdOnly } from "./context/summarization-engine.js";

/** contract: ContextCompiler */
export function registerContextCompiler(bus: EventBus): void {
  const logger = createConsoleLogger("context-compiler");

  bus.subscribe(EVENT_TYPES.INTENT_CLASSIFIED, async (event) => {
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

    const { correlationId, tenantId, id: causationId } = event;

    logger.info("CONTEXT_SNAPSHOT_BUILT", { correlationId, tenantId, causationId });
    metrics.emit("context_snapshot_built", { correlationId, tenantId, causationId, service: "context-compiler" });

    await bus.publish(
      devEvent(
        `ctx_${event.id}`,
        EVENT_TYPES.MEMORY_UPDATED,
        {
          kind: "CONTEXT_SNAPSHOT",
          safetyLayer: "production-pass",
          activeConversation: [event.payload],
          rankedCustomerMemory: [],
          businessFacts: [],
          warmColdSummary,
          retrieval,
        },
        correlationId,
        event.id,
        tenantId,
      ),
    );
  });
}