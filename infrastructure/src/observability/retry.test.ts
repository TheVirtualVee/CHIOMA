import { describe, expect, it } from "vitest";
import { createSafeHandler } from "./safe-handler.js";
import { createConsoleLogger } from "./logger.js";
import { devEvent } from "../event-bus/in-memory.js";
import { EVENT_TYPES } from "@chioma/core";

describe("SafeHandler Retries", () => {
  it("retries failed operations up to maxRetries", async () => {
    const logger = createConsoleLogger("test-service");
    let attempts = 0;
    
    const handler = async () => {
      attempts++;
      throw new Error("retryable failure");
    };

    const safeHandler = createSafeHandler(handler, {
      service: "test-service",
      operation: "test-op",
      logger,
      retry: { maxRetries: 2, initialDelayMs: 10, factor: 1 },
    });

    const event = devEvent("e1", EVENT_TYPES.MESSAGE_RECEIVED, {}, "c1", null, "tenant1");

    await expect(safeHandler(event)).rejects.toThrow("retryable failure");
    
    // 1 initial attempt + 2 retries = 3 attempts total
    expect(attempts).toBe(3);
  });

  it("succeeds if a retry eventually passes", async () => {
    const logger = createConsoleLogger("test-service");
    let attempts = 0;
    
    const handler = async () => {
      attempts++;
      if (attempts < 2) throw new Error("first fail");
      return;
    };

    const safeHandler = createSafeHandler(handler, {
      service: "test-service",
      operation: "test-op",
      logger,
      retry: { maxRetries: 3, initialDelayMs: 10, factor: 1 },
    });

    const event = devEvent("e1", EVENT_TYPES.MESSAGE_RECEIVED, {}, "c1", null, "tenant1");

    await safeHandler(event);
    expect(attempts).toBe(2);
  });
});
