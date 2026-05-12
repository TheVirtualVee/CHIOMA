import { describe, expect, it } from "vitest";
import { EVENT_TYPES, assertDomainEvent } from "@chioma/core";

describe("eval: event sourcing envelope", () => {
  it("tenant isolation field is mandatory and must be non-empty", () => {
    const e = assertDomainEvent({
      id: "e_t1",
      type: EVENT_TYPES.MESSAGE_RECEIVED,
      occurredAt: new Date().toISOString(),
      payload: {},
      correlationId: "c1",
      causationId: null,
      tenantId: "biz_123",
    });
    expect(e.tenantId).toBe("biz_123");
  });
});
