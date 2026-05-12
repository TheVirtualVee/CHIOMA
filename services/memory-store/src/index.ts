import { EVENT_TYPES, type EventBus } from "@chioma/core";
import { createConsoleLogger, createInMemoryProjectionStore } from "@chioma/infrastructure";

export function registerMemoryStore(bus: EventBus): void {
  const log = createConsoleLogger("memory-store");
  const projections = createInMemoryProjectionStore();

  bus.subscribe(EVENT_TYPES.MEMORY_UPDATED, async (e) => {
    if (projections.hasApplied(e.id)) return;
    projections.recordApplied(e.id);
    const kind = (e.payload as { kind?: string } | null)?.kind;
    log.info("MEMORY_UPDATED_APPLIED", { correlationId: e.correlationId, kind, tenantId: e.tenantId });
  });
}
