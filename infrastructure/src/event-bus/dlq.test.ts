import { describe, expect, it } from "vitest";
import { InMemoryEventBus, createAppendOnlyLog, devEvent } from "./in-memory.js";
import { createInMemoryDeadLetterStore } from "../database/stores.js";
import { EVENT_TYPES } from "@chioma/core";

describe("Dead Letter Queue support", () => {
  it("routes failed events to DLQ", async () => {
    const log = createAppendOnlyLog();
    const dlq = createInMemoryDeadLetterStore();
    const bus = new InMemoryEventBus(log, dlq);

    bus.subscribe(EVENT_TYPES.MESSAGE_RECEIVED, async () => {
      throw new Error("processing failure");
    });

    const event = devEvent(
      "e1",
      EVENT_TYPES.MESSAGE_RECEIVED,
      { text: "fail me" },
      "c1",
      null,
      "tenant1"
    );

    await expect(bus.publish(event)).rejects.toThrow("processing failure");
    
    expect(dlq.all()).toHaveLength(1);
    expect(dlq.all()[0].event.id).toBe("e1");
    expect(dlq.all()[0].error).toBe("Error: processing failure");
  });
});
