export const EVENT_TYPES = {
  MESSAGE_RECEIVED: "MESSAGE_RECEIVED",
  INTENT_CLASSIFIED: "INTENT_CLASSIFIED",
  COMMITMENT_CREATED: "COMMITMENT_CREATED",
  COMMITMENT_UPDATED: "COMMITMENT_UPDATED",
  COMMITMENT_RESOLVED: "COMMITMENT_RESOLVED",
  ESCALATION_TRIGGERED: "ESCALATION_TRIGGERED",
  RESPONSE_SENT: "RESPONSE_SENT",
  MEMORY_UPDATED: "MEMORY_UPDATED",
  /** v1.1 — extracted business proposals; never authoritative until owner confirms */
  BUSINESS_SYNTHESIS_PROPOSED: "BUSINESS_SYNTHESIS_PROPOSED",
  /** v1.1 — owner-approved patches applied via projections only */
  BUSINESS_STATE_OWNER_CONFIRMED: "BUSINESS_STATE_OWNER_CONFIRMED",
  /** v1.1 — conversational policy proposals pending confirmation */
  BUSINESS_TRAINING_PROPOSED: "BUSINESS_TRAINING_PROPOSED",
  /** v1.1 — reliability / degraded-mode signals */
  RELIABILITY_ALERT: "RELIABILITY_ALERT",
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

const ALL_EVENT_TYPES: readonly EventType[] = Object.values(EVENT_TYPES);

export type DomainEvent<T extends EventType = EventType> = {
  id: string;
  type: T;
  occurredAt: string;
  payload: unknown;
  correlationId: string;
  causationId: string | null;
  /** v1.1 — mandatory for production projections; optional during early scaffold */
  tenantId?: string;
};

export class InvalidDomainEventError extends Error {
  readonly code = "UNKNOWN_EVENT_TYPE" as const;
  constructor(message: string) {
    super(message);
    this.name = "InvalidDomainEventError";
  }
}

export function assertDomainEvent(input: unknown): DomainEvent {
  if (!input || typeof input !== "object") {
    throw new InvalidDomainEventError("UNKNOWN_EVENT_TYPE: event must be an object");
  }
  const e = input as Partial<DomainEvent>;
  if (typeof e.type !== "string" || !ALL_EVENT_TYPES.includes(e.type as EventType)) {
    throw new InvalidDomainEventError(`UNKNOWN_EVENT_TYPE: ${String(e.type)}`);
  }
  if (typeof e.id !== "string" || e.id.length === 0) {
    throw new InvalidDomainEventError("UNKNOWN_EVENT_TYPE: id required");
  }
  if (typeof e.occurredAt !== "string") {
    throw new InvalidDomainEventError("UNKNOWN_EVENT_TYPE: occurredAt required");
  }
  if (typeof e.correlationId !== "string" || e.correlationId.length === 0) {
    throw new InvalidDomainEventError("UNKNOWN_EVENT_TYPE: correlationId required");
  }
  if (e.causationId !== null && typeof e.causationId !== "string") {
    throw new InvalidDomainEventError("UNKNOWN_EVENT_TYPE: causationId invalid");
  }
  if (e.tenantId !== undefined && typeof e.tenantId !== "string") {
    throw new InvalidDomainEventError("UNKNOWN_EVENT_TYPE: tenantId invalid");
  }
  return e as DomainEvent;
}
