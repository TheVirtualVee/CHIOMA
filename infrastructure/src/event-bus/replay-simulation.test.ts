import { describe, expect, it } from "vitest";
import { InMemoryEventBus, createAppendOnlyLog, devEvent } from "./in-memory.js";
import { createInMemoryProjectionStore } from "../database/stores.js";
import { EVENT_TYPES, type DomainEvent } from "@chioma/core";

describe("Replay Simulation Suite", () => {
  it("survives duplicate events via projection store", async () => {
    const log = createAppendOnlyLog();
    const projection = createInMemoryProjectionStore();
    const bus = new InMemoryEventBus(log, undefined, projection);

    let processed = 0;
    bus.subscribe(EVENT_TYPES.MESSAGE_RECEIVED, async () => {
      processed++;
    });

    const event = devEvent("e1", EVENT_TYPES.MESSAGE_RECEIVED, {}, "c1", null, "t1");

    await bus.publish(event);
    await bus.publish(event); // Replay/Duplicate

    expect(processed).toBe(1);
  });

  it("can replay a sequence of events to reconstruct state", async () => {
    const log = createAppendOnlyLog();
    const projection = createInMemoryProjectionStore();
    
    // Initial sequence
    const e1 = devEvent("e1", EVENT_TYPES.MESSAGE_RECEIVED, { text: "1" }, "c1", null, "t1");
    const e2 = devEvent("e2", EVENT_TYPES.INTENT_CLASSIFIED, { text: "1" }, "c1", "e1", "t1");
    
    log.append(e1);
    log.append(e2);

    // Simulation: New bus instance replaying from log
    const bus = new InMemoryEventBus(createAppendOnlyLog(), undefined, projection);
    let lastIntent = "";
    bus.subscribe(EVENT_TYPES.INTENT_CLASSIFIED, async (e) => {
      lastIntent = (e.payload as any).text;
    });

    for (const event of await log.all()) {
      await bus.publish(event);
    }

    expect(lastIntent).toBe("1");
    expect(await projection.hasApplied("t1", "e1")).toBe(true);
    expect(await projection.hasApplied("t1", "e2")).toBe(true);
  });
});
