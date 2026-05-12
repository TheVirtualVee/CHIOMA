import { EVENT_TYPES, type EventBus } from "@chioma/core";
import { createConsoleLogger, createInMemoryProjectionStore, metrics } from "@chioma/infrastructure";

/** contract: MemoryStore */
export function registerMemoryStore(bus: EventBus): void {
  const logger = createConsoleLogger("memory-store");
  const projections = createInMemoryProjectionStore();

  bus.subscribe(EVENT_TYPES.MEMORY_UPDATED, async (event) => {
    const { id, tenantId, correlationId, payload } = event;
    const causationId = id; // constraint: enforces lineage

    if (await projections.hasApplied(tenantId, id)) return;
    
    await projections.recordApplied(tenantId, id);
    
    const kind = (payload as { kind?: string } | null)?.kind;
    
    logger.info("MEMORY_UPDATED_APPLIED", { correlationId, kind, tenantId, causationId });
    metrics.emit("memory_updated", { correlationId, tenantId, causationId, service: "memory-store" });

    await bus.publish({
      id: `done_${event.id}`,
      type: EVENT_TYPES.EXECUTION_COMPLETED,
      occurredAt: new Date().toISOString(),
      payload: { service: "memory-store", action: "PROJECTION_UPDATED", kind },
      correlationId,
      causationId,
      tenantId
    });
  });
}
