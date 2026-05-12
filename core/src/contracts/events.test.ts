import { describe, expect, it } from "vitest";
import { assertDomainEvent, EVENT_TYPES } from "./events.js";

describe("assertDomainEvent", () => {
  it("rejects unknown event type with structured error", () => {
    expect(() =>
      assertDomainEvent({
        id: "e1",
        type: "UNKNOWN" as never,
        occurredAt: new Date().toISOString(),
        payload: {},
        correlationId: "c1",
        causationId: null,
      }),
    ).toThrowError(/UNKNOWN_EVENT_TYPE/);
  });

  it("accepts a minimal BUSINESS_SYNTHESIS_PROPOSED envelope", () => {
    const e = assertDomainEvent({
      id: "e_syn",
      type: EVENT_TYPES.BUSINESS_SYNTHESIS_PROPOSED,
      occurredAt: new Date().toISOString(),
      payload: { proposalId: "p1" },
      correlationId: "c1",
      causationId: null,
      tenantId: "tenant_a",
    });
    expect(e.type).toBe(EVENT_TYPES.BUSINESS_SYNTHESIS_PROPOSED);
    expect(e.tenantId).toBe("tenant_a");
  });

  it("accepts a minimal MESSAGE_RECEIVED envelope", () => {
    const e = assertDomainEvent({
      id: "e1",
      type: EVENT_TYPES.MESSAGE_RECEIVED,
      occurredAt: new Date().toISOString(),
      payload: { channel: "whatsapp", text: "hi" },
      correlationId: "c1",
      causationId: null,
    });
    expect(e.type).toBe(EVENT_TYPES.MESSAGE_RECEIVED);
  });
});
