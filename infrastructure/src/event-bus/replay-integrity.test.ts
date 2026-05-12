import { describe, expect, it } from "vitest";
import { InMemoryEventBus, createAppendOnlyLog, devEvent } from "./in-memory.js";
import { createInMemoryProjectionStore } from "../database/stores.js";
import { EVENT_TYPES } from "@chioma/core";

describe("Replay Integrity (Phase B Hardening)", () => {
  it("enforces tenant-scoped replay isolation", async () => {
    const log = createAppendOnlyLog();
    const projection = createInMemoryProjectionStore();
    
    // Sequence for two tenants
    const e1 = devEvent("e1", EVENT_TYPES.MESSAGE_RECEIVED, {}, "c1", null, "tenant_a");
    const e2 = devEvent("e2", EVENT_TYPES.MESSAGE_RECEIVED, {}, "c2", null, "tenant_b");
    
    await log.append(e1);
    await log.append(e2);

    // Replay for tenant_a ONLY
    const busA = new InMemoryEventBus(createAppendOnlyLog(), undefined, projection);
    let countA = 0;
    busA.subscribe(EVENT_TYPES.MESSAGE_RECEIVED, async () => { countA++; });

    for (const e of await log.all()) {
      if (e.tenantId === "tenant_a") {
        await busA.publish(e);
      }
    }

    expect(countA).toBe(1);
    expect(await projection.hasApplied("tenant_a", "e1")).toBe(true);
    expect(await projection.hasApplied("tenant_b", "e1")).toBe(false);
  });

  it("fails explicitly if replaying an event without tenantId", async () => {
    const log = createAppendOnlyLog();
    const bus = new InMemoryEventBus(log);
    
    const badEvent = {
      id: "bad",
      type: EVENT_TYPES.MESSAGE_RECEIVED,
      occurredAt: new Date().toISOString(),
      payload: {},
      correlationId: "c1",
      causationId: null,
    } as any;

    await expect(bus.publish(badEvent)).rejects.toThrow(/TENANT_ISOLATION_FAILURE/);
  });
});
