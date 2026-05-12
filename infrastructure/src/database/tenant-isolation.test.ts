import { describe, expect, it } from "vitest";
import { createInMemoryProjectionStore, createReadModelStore } from "./stores.js";
import { devEvent } from "../event-bus/in-memory.js";
import { EVENT_TYPES } from "@chioma/core";

describe("Tenant Isolation Hardening", () => {
  it("projection store rejects operations without tenantId", async () => {
    const store = createInMemoryProjectionStore();
    await expect(store.recordApplied("", "e1")).rejects.toThrow(/TENANT_ISOLATION_FAILURE/);
    await expect(store.hasApplied("", "e1")).rejects.toThrow(/TENANT_ISOLATION_FAILURE/);
  });

  it("projection store isolates applied events between tenants", async () => {
    const store = createInMemoryProjectionStore();
    await store.recordApplied("tenant_a", "e1");
    
    expect(await store.hasApplied("tenant_a", "e1")).toBe(true);
    expect(await store.hasApplied("tenant_b", "e1")).toBe(false);
  });

  it("read model isolates last event between tenants", async () => {
    const store = createReadModelStore();
    const e1 = devEvent("e1", EVENT_TYPES.MESSAGE_RECEIVED, {}, "c1", null, "tenant_a");
    const e2 = devEvent("e2", EVENT_TYPES.MESSAGE_RECEIVED, {}, "c2", null, "tenant_b");

    await store.setLastEvent("tenant_a", e1);
    await store.setLastEvent("tenant_b", e2);

    expect((await store.getLastEvent("tenant_a"))?.id).toBe("e1");
    expect((await store.getLastEvent("tenant_b"))?.id).toBe("e2");
  });

  it("read model rejects event with mismatched tenantId", async () => {
    const store = createReadModelStore();
    const e1 = devEvent("e1", EVENT_TYPES.MESSAGE_RECEIVED, {}, "c1", null, "tenant_a");

    await expect(store.setLastEvent("tenant_b", e1)).rejects.toThrow(/TENANT_ISOLATION_FAILURE/);
  });
});
