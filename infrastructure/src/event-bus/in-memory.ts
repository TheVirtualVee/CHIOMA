import type { DomainEvent, EventType } from "@chioma/core";
import type { EventBus, EventHandler } from "@chioma/core";

export type AppendOnlyEventLog = {
  append: (event: DomainEvent) => void;
  all: () => readonly DomainEvent[];
};

export function createAppendOnlyLog(): AppendOnlyEventLog {
  const events: DomainEvent[] = [];
  return {
    append(e) {
      events.push(e);
    },
    all: () => events,
  };
}

export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<EventType, EventHandler[]>();
  private readonly seenIds = new Set<string>();
  private readonly log: AppendOnlyEventLog;

  constructor(log: AppendOnlyEventLog) {
    this.log = log;
  }

  subscribe(type: EventType, handler: EventHandler): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  async publish(event: DomainEvent): Promise<void> {
    if (this.seenIds.has(event.id)) {
      return;
    }
    this.seenIds.add(event.id);
    this.log.append(event);
    const list = this.handlers.get(event.type) ?? [];
    for (const h of list) {
      await h(event);
    }
  }
}

export function createBus(log: AppendOnlyEventLog): InMemoryEventBus {
  return new InMemoryEventBus(log);
}

/** Dev helper: deterministic event ids */
export function devEvent(
  id: string,
  type: EventType,
  payload: unknown,
  correlationId: string,
  causationId: string | null,
  tenantId?: string,
): DomainEvent {
  const e: DomainEvent = {
    id,
    type,
    occurredAt: new Date().toISOString(),
    payload,
    correlationId,
    causationId,
  };
  if (tenantId !== undefined) {
    e.tenantId = tenantId;
  }
  return e;
}
