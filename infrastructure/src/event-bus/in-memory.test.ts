import { describe, expect, it } from "vitest";
import { EVENT_TYPES } from "@chioma/core";
import { createAppendOnlyLog, createBus, devEvent } from "./in-memory.js";
import { createInMemoryProjectionStore } from "../database/stores.js";

describe("InMemoryEventBus", () => {
  it("does not invoke handlers twice for the same event id (idempotent publish)", async () => {
    const log = createAppendOnlyLog();
    const projection = createInMemoryProjectionStore();
    const bus = createBus(log, undefined, projection);
    let count = 0;
    bus.subscribe(EVENT_TYPES.MESSAGE_RECEIVED, async () => {
      count += 1;
    });
    const e = devEvent("evt-1", EVENT_TYPES.MESSAGE_RECEIVED, {}, "corr-1", null, "t1");
    await bus.publish(e);
    await bus.publish(e);
    expect(count).toBe(1);
    expect((await log.all()).length).toBe(1);
  });
});
