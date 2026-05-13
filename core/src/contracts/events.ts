export const EVENT_TYPES = {
  MESSAGE_RECEIVED: "MESSAGE_RECEIVED",
  INTENT_CLASSIFIED: "INTENT_CLASSIFIED",
  COMMITMENT_CREATED: "COMMITMENT_CREATED",
  COMMITMENT_UPDATED: "COMMITMENT_UPDATED",
  COMMITMENT_RESOLVED: "COMMITMENT_RESOLVED",
  ESCALATION_TRIGGERED: "ESCALATION_TRIGGERED",
  RESPONSE_SENT: "RESPONSE_SENT",
  MEMORY_UPDATED: "MEMORY_UPDATED",
  BUSINESS_SYNTHESIS_PROPOSED: "BUSINESS_SYNTHESIS_PROPOSED",
  BUSINESS_STATE_OWNER_CONFIRMED: "BUSINESS_STATE_OWNER_CONFIRMED",
  BUSINESS_TRAINING_PROPOSED: "BUSINESS_TRAINING_PROPOSED",
  RELIABILITY_ALERT: "RELIABILITY_ALERT",
  EXECUTION_COMPLETED: "EXECUTION_COMPLETED",
  EXECUTION_FAILED: "EXECUTION_FAILED",
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

const ALL_EVENT_TYPES: readonly EventType[] = Object.values(EVENT_TYPES);

/** contract: DomainEvent */
export type DomainEvent<T extends EventType = EventType> = {
  id: string;
  type: T;
  occurredAt: string;
  payload: unknown;
  correlationId: string;
  causationId: string | null;
  tenantId: string;
};

export class InvalidDomainEventError extends Error {
  readonly code = "INVALID_DOMAIN_EVENT" as const;
  constructor(message: string) {
    super(message);
    this.name = "InvalidDomainEventError";
  }
}

import { z } from "zod";
import { DefaultIdFactory } from "./context.js";

export const EventSchema = z.object({
  id: z.string().min(1),
  type: z.string(),
  occurredAt: z.string().datetime(),
  payload: z.unknown(),
  correlationId: z.string().min(1),
  causationId: z.string().nullable(),
  tenantId: z.string().min(1),
});

export function assertDomainEvent(input: unknown): DomainEvent {
  const result = EventSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues;
    const tenantIssue = issues.find((i) => i.path.includes("tenantId"));
    if (tenantIssue) {
      throw new InvalidDomainEventError("INVALID_DOMAIN_EVENT: tenantId required");
    }
    const correlationIssue = issues.find((i) => i.path.includes("correlationId"));
    if (correlationIssue) {
      throw new InvalidDomainEventError("INVALID_DOMAIN_EVENT: correlationId required");
    }
    throw new InvalidDomainEventError(`INVALID_DOMAIN_EVENT: ${result.error.message}`);
  }
  const e = result.data as DomainEvent;
  if (!ALL_EVENT_TYPES.includes(e.type as EventType)) {
    throw new InvalidDomainEventError(`INVALID_DOMAIN_EVENT: unknown type: ${String(e.type)}`);
  }
  return e;
}

export function createEvent<T extends EventType>(
  type: T,
  payload: unknown,
  tenantId: string,
  correlationId?: string,
): DomainEvent<T> {
  const id = DefaultIdFactory.nextId("ev");
  return {
    id,
    type,
    occurredAt: new Date().toISOString(),
    payload,
    correlationId: correlationId || id,
    causationId: null,
    tenantId,
  };
}

/** constraint: preserves lineage */
export function createFollowupEvent<T extends EventType>(
  type: T,
  payload: unknown,
  trigger: DomainEvent,
): DomainEvent<T> {
  return {
    id: DefaultIdFactory.nextId("ev"),
    type,
    occurredAt: new Date().toISOString(),
    payload,
    correlationId: trigger.correlationId,
    causationId: trigger.id,
    tenantId: trigger.tenantId,
  };
}
