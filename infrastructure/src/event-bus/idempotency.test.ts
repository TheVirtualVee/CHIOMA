import { describe, expect, it } from "vitest";
import { InMemoryEventBus, createAppendOnlyLog, devEvent } from "./in-memory.js";
import { createInMemoryProjectionStore } from "../database/stores.js";
import { EVENT_TYPES } from "@chioma/core";

describe("Event Bus Idempotency", () => {
  it("prevents double-processing of the same event id", async () => {
    const log = createAppendOnlyLog();
    const projection = createInMemoryProjectionStore();
    const bus = new InMemoryEventBus(log, undefined, projection);

    let count = 0;
    bus.subscribe(EVENT_TYPES.MESSAGE_RECEIVED, async () => {
      count++;
    });

    const event = devEvent(
      "e1",
      EVENT_TYPES.MESSAGE_RECEIVED,
      { text: "hi" },
      "c1",
      null,
      "tenant1"
    );

    await bus.publish(event);
    await bus.publish(event); // Duplicate

    expect(count).toBe(1);
    expect(await log.all()).toHaveLength(1);
  });
});
