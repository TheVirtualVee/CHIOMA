import { EVENT_TYPES, type EventBus } from "@chioma/core";
import { createConsoleLogger, devEvent, metrics } from "@chioma/infrastructure";
import { buildHybridRetrievalHints } from "./context/retrieval-scoring.js";
import { summarizeWarmColdOnly } from "./context/summarization-engine.js";
import type postgres from "postgres";

/** contract: ContextCompiler */
export function registerContextCompiler(bus: EventBus, sql: postgres.Sql): void {
  const logger = createConsoleLogger("context-compiler");

  bus.subscribe(EVENT_TYPES.INTENT_CLASSIFIED, async (event) => {
    const { correlationId, tenantId, id: causationId } = event;

    // 1. Fetch Employer Context (Institutional Identity)
    const [profile] = await sql`SELECT * FROM employer_profiles WHERE tenant_id = ${tenantId}`;
    const [memory] = await sql`SELECT * FROM operational_memory WHERE tenant_id = ${tenantId}`;

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
          businessFacts: [
            { key: "business_name", value: profile?.business_name },
            { key: "category", value: profile?.category },
            { key: "working_hours", value: profile?.working_hours },
            { key: "tone_profile", value: memory?.tone_profile },
            { key: "high_value_items", value: memory?.high_value_items },
          ],
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