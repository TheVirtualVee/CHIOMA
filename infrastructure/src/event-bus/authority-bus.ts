import type { DomainEvent, EventType } from "@chioma/core";
import type { EventBus, EventHandler } from "@chioma/core";
import type { DeadLetterStore, EventProjectionStore } from "../database/stores.js";
import { createConsoleLogger } from "../observability/logger.js";
import { AppendOnlyEventLog } from "./in-memory.js";

const logger = createConsoleLogger("authority-bus");

/** contract: StrictAuthorityEventBus */
export class StrictAuthorityEventBus implements EventBus {
  private readonly handlers = new Map<EventType, EventHandler[]>();
  private readonly log: AppendOnlyEventLog;
  private readonly dlq?: DeadLetterStore;
  private readonly projectionStore?: EventProjectionStore;
  private readonly pendingApplied = new Set<string>();

  constructor(log: AppendOnlyEventLog, dlq?: DeadLetterStore, projectionStore?: EventProjectionStore) {
    this.log = log;
    this.dlq = dlq;
    this.projectionStore = projectionStore;
  }

  subscribe(type: EventType, handler: EventHandler): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  async publish(event: DomainEvent): Promise<void> {
    if (!event.tenantId) {
      throw new Error("TENANT_ISOLATION_FAILURE: tenantId is required for all events");
    }
    
    /** constraint: Deterministic identity headers required */
    if (!event.id || !event.correlationId) {
       throw new Error("EXECUTION_FAILED: Event is missing mandatory deterministic identity headers");
    }

    const key = `${event.tenantId}:${event.id}`;
    if (this.pendingApplied.has(key)) return;
    this.pendingApplied.add(key);

    try {
      /** constraint: Idempotency Guard */
      if (this.projectionStore && await this.projectionStore.hasApplied(event.tenantId, event.id)) {
        return;
      }
      
      /** contract: Single Source of Truth Write */
      await this.log.append(event);

      /** side-effect: Projection Guard Update */
      await this.projectionStore?.recordApplied(event.tenantId, event.id);
    } catch (e) {
      logger.error("EVENT_COMMIT_FAILED", { eventId: event.id, tenantId: event.tenantId, error: String(e) });
      throw e;
    } finally {
      this.pendingApplied.delete(key);
    }
  }

  /**
   * contract: Side-Effect Post-Commit Dispatch
   */
  async dispatchLocally(event: DomainEvent): Promise<void> {
    const list = this.handlers.get(event.type) ?? [];
    for (const h of list) {
      try {
        await h(event);
      } catch (e) {
        if (this.dlq) {
          this.dlq.store({
            event,
            error: String(e),
            failedAt: new Date().toISOString(),
            service: "side-effects",
          });
        }
        throw e;
      }
    }
  }

  async hydrate(events: readonly DomainEvent[]): Promise<void> {
    if (events.length === 0) return;
    for (const event of events) {
      if (this.projectionStore && await this.projectionStore.hasApplied(event.tenantId, event.id)) {
        continue;
      }
      await this.dispatchLocally(event);
      await this.projectionStore?.recordApplied(event.tenantId, event.id);
    }
  }
}

export function createAuthorityBus(log: AppendOnlyEventLog, dlq?: DeadLetterStore, projectionStore?: EventProjectionStore): StrictAuthorityEventBus {
  return new StrictAuthorityEventBus(log, dlq, projectionStore);
}
