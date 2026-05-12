import type { DomainEvent, EventType } from "@chioma/core";
import type { EventBus, EventHandler } from "@chioma/core";
import type { DeadLetterStore, EventProjectionStore } from "../database/stores.js";
import { createConsoleLogger } from "../observability/logger.js";

const logger = createConsoleLogger("event-bus");

export type AppendOnlyEventLog = {
  append: (event: DomainEvent) => Promise<void>;
  all: () => Promise<readonly DomainEvent[]>;
};

export function createAppendOnlyLog(): AppendOnlyEventLog {
  const events: DomainEvent[] = [];
  return {
    async append(e) {
      events.push(e);
    },
    all: async () => events,
  };
}

export class InMemoryEventBus implements EventBus {
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
      throw new Error("TENANT_ISOLATION_FAILURE");
    }
    const key = `${event.tenantId}:${event.id}`;
    if (this.pendingApplied.has(key)) return;
    this.pendingApplied.add(key);
    try {
      if (this.projectionStore && await this.projectionStore.hasApplied(event.tenantId, event.id)) {
        return;
      }
      await this.projectionStore?.recordApplied(event.tenantId, event.id);
      await this.log.append(event);
      const list = this.handlers.get(event.type) ?? [];
      for (const h of list) {
        try {
          await h(event);
        } catch (e) {
          if (this.dlq) {
            // side-effect: dead letter storage
            this.dlq.store({
              event,
              error: String(e),
              failedAt: new Date().toISOString(),
              service: "event-bus",
            });
          }
          throw e;
        }
      }
    } finally {
      this.pendingApplied.delete(key);
    }
  }

  async hydrate(events: readonly DomainEvent[]): Promise<void> {
    if (events.length === 0) return;
    for (const event of events) {
      if (this.projectionStore && await this.projectionStore.hasApplied(event.tenantId, event.id)) {
        continue;
      }
      const list = this.handlers.get(event.type) ?? [];
      for (const h of list) {
        try {
          await h(event);
        } catch (e) {
          // side-effect: log hydration failure
          logger.error("HYDRATION_FAILURE", { eventId: event.id, tenantId: event.tenantId, error: String(e) });
        }
      }
      await this.projectionStore?.recordApplied(event.tenantId, event.id);
    }
  }
}

export function createBus(log: AppendOnlyEventLog, dlq?: DeadLetterStore, projectionStore?: EventProjectionStore): InMemoryEventBus {
  return new InMemoryEventBus(log, dlq, projectionStore);
}

/** contract: DevHelper */
export function devEvent(
  id: string,
  type: EventType,
  payload: unknown,
  correlationId: string,
  causationId: string | null,
  tenantId: string,
): DomainEvent {
  return {
    id,
    type,
    occurredAt: new Date().toISOString(),
    payload,
    correlationId,
    causationId,
    tenantId,
  };
}
