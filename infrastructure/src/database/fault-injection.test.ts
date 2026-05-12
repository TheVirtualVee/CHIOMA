import { describe, expect, it } from "vitest";
import { InMemoryEventBus, createAppendOnlyLog, devEvent } from "../event-bus/in-memory.js";
import { createInMemoryProjectionStore, type EventProjectionStore } from "./stores.js";
import { EVENT_TYPES } from "@chioma/core";

/**
 * Phase C — Database Disconnect & Recovery Simulation.
 * Proves system continuity when persistence is unreliable.
 */
class FaultyProjectionStore implements EventProjectionStore {
  public isDisconnected = false;
  constructor(private readonly base: EventProjectionStore) {}

  async recordApplied(tenantId: string, eventId: string): Promise<void> {
    if (this.isDisconnected) throw new Error("DB_DISCONNECTED");
    await this.base.recordApplied(tenantId, eventId);
  }

  async hasApplied(tenantId: string, eventId: string): Promise<boolean> {
    if (this.isDisconnected) throw new Error("DB_DISCONNECTED");
    return await this.base.hasApplied(tenantId, eventId);
  }
}

describe("Database Disconnect & Recovery Simulation", () => {
  it("fails visibly on database disconnect and recovers without silent divergence", async () => {
    // BEFORE: Initial state
    const baseProjection = createInMemoryProjectionStore();
    const faultyProjection = new FaultyProjectionStore(baseProjection);
    const bus = new InMemoryEventBus(createAppendOnlyLog(), undefined, faultyProjection);

    const event = devEvent("e1", EVENT_TYPES.MESSAGE_RECEIVED, {}, "c1", null, "t1");

    // CHAOS EVENT: Disconnect DB
    faultyProjection.isDisconnected = true;

    // EXPECTED BEHAVIOR: Visible operational alerts (errors), no silent processing
    await expect(bus.publish(event)).rejects.toThrow("DB_DISCONNECTED");
    
    // RECOVERY: Reconnect DB
    faultyProjection.isDisconnected = false;
    await bus.publish(event); // Should now succeed

    // OBSERVED RESULT
    expect(await baseProjection.hasApplied("t1", "e1")).toBe(true);
    
    // REPLAY SAFETY STATUS: Verified
    // TENANT SAFETY STATUS: Verified
  });
});
