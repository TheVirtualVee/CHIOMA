import type { DomainEvent, EventHandler } from "@chioma/core";
import type { ChiomaLogger } from "./logger.js";
import { metrics } from "./metrics.js";
import { withRetry, type RetryOptions } from "../utils/retry.js";

export type SafeHandlerOptions = {
  service: string;
  operation: string;
  logger: ChiomaLogger;
  retry?: Partial<RetryOptions>;
  timeoutMs?: number;
};

/**
 * Higher-order function to wrap an event handler with observability and resilience.
 * Enforces Rule 2: log structured context, emit metrics, fail explicitly.
 * Phase A Hardening: adds bounded retries with exponential backoff.
 * Phase D Hardening: adds handler timeout enforcement.
 */
export function createSafeHandler(
  handler: EventHandler,
  options: SafeHandlerOptions,
): EventHandler {
  return async (event: DomainEvent) => {
    const { service, operation, logger, retry, timeoutMs = 15000 } = options;
    const start = Date.now();
    const ctx = {
      service,
      operation,
      eventId: event.id,
      eventType: event.type,
      tenantId: event.tenantId,
      correlationId: event.correlationId,
    };

    try {
      const handlerPromise = withRetry(() => handler(event), {
        ...retry,
        onRetry: (err, attempt, delay) => {
          logger.warn(`${operation}_RETRYING`, { ...ctx, attempt, delay, error: String(err) });
          metrics.emit(`handler_retry`, { ...ctx, attempt });
        },
      });

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("TIMEOUT_EXCEEDED")), timeoutMs)
      );

      await Promise.race([handlerPromise, timeoutPromise]);
      const latency = Date.now() - start;
      
      // Emit success metric
      metrics.emit(`handler_success`, { ...ctx, latency });
      
      logger.info(`${operation}_SUCCESS`, { ...ctx, latency });
    } catch (error) {
      const latency = Date.now() - start;
      
      // Emit failure metric
      metrics.emit(`handler_failure`, { ...ctx, latency, error: String(error) });
      
      logger.error(`${operation}_FAILED`, {
        ...ctx,
        latency,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      });

      // FAIL EXPLICITLY: propagate traceable error
      throw error;
    }
  };
}
