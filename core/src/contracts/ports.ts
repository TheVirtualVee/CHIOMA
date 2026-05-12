import type { DomainEvent, EventType } from "./events.js";

export type EventHandler = (event: DomainEvent) => Promise<void>;

export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe(type: EventType, handler: EventHandler): void;
}
