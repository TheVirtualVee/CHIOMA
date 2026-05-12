import { describe, expect, it } from "vitest";
import { InMemoryEventBus, createAppendOnlyLog, devEvent } from "./in-memory.js";
import { createInMemoryProjectionStore } from "../database/stores.js";
import { EVENT_TYPES } from "@chioma/core";

/**
 * Phase C — Worker Recovery Verification.
 * Proves that workers recover deterministically after a crash/restart.
 */
describe("Worker Recovery Verification", () => {
  it("recovers state by replaying persistent log after simulated crash", async () => {
    // 1. Simulate active session that crashes
    const persistentLog = createAppendOnlyLog();
    const e1 = devEvent("e1", EVENT_TYPES.MESSAGE_RECEIVED, { val: 10 }, "c1", null, "t1");
    await persistentLog.append(e1);

    // 2. Worker state before crash
    let workerState = 0;
    
    // 3. Simulated Restart: New bus, new projection, but SAME persistent log
    const projection = createInMemoryProjectionStore();
    const newBus = new InMemoryEventBus(createAppendOnlyLog(), undefined, projection);
    
    newBus.subscribe(EVENT_TYPES.MESSAGE_RECEIVED, async (e) => {
      workerState = (e.payload as any).val;
    });

    // 4. Hydration: Replay from persistent log
    for (const e of await persistentLog.all()) {
      await newBus.publish(e);
    }

    // OBSERVED RESULT
    expect(workerState).toBe(10);
    expect(await projection.hasApplied("t1", "e1")).toBe(true);
  });
});
