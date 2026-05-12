import { describe, expect, it, vi } from "vitest";
import { metrics } from "./metrics.js";
import { createSafeHandler } from "./safe-handler.js";
import { createConsoleLogger } from "./logger.js";
import { EVENT_TYPES } from "@chioma/core";

describe("Observability Gap Simulation", () => {
  it("warns when emitting metrics without tenantId or service", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    
    metrics.emit("test_metric", { correlationId: "c1" } as any);
    
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("METRICS_MALFORMED"), expect.anything());
    spy.mockRestore();
  });

  it("SafeHandler captures and logs tenantId and correlationId in all states", async () => {
    const logger = createConsoleLogger("test-service");
    const infoSpy = vi.spyOn(logger, "info");
    
    const handler = createSafeHandler(async () => {}, {
      service: "test-service",
      operation: "op1",
      logger
    });

    const event = {
      id: "e1",
      type: EVENT_TYPES.MESSAGE_RECEIVED,
      occurredAt: new Date().toISOString(),
      payload: {},
      correlationId: "c1",
      causationId: null,
      tenantId: "t1"
    };

    await handler(event);
    
    expect(infoSpy).toHaveBeenCalledWith(
      "op1_SUCCESS",
      expect.objectContaining({
        tenantId: "t1",
        correlationId: "c1",
        service: "test-service"
      })
    );
  });
});
