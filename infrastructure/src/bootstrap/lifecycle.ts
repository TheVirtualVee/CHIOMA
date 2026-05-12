import { createConsoleLogger } from "../observability/logger.js";

/**
 * Manages service lifecycle: startup, health, and graceful shutdown.
 * Enforces Phase A Rule 3: Service recovery guarantees.
 */
export class LifecycleManager {
  private readonly log = createConsoleLogger("lifecycle");
  private isShuttingDown = false;
  private isReady = false;
  private readonly shutdownHandlers: (() => Promise<void>)[] = [];

  constructor() {
    // Listen for termination signals
    process.on("SIGTERM", () => this.shutdown("SIGTERM"));
    process.on("SIGINT", () => this.shutdown("SIGINT"));
  }

  setReady(): void {
    this.isReady = true;
    this.log.info("SERVICE_READY");
  }

  healthCheck(): { status: string; uptime: number } {
    return {
      status: this.isShuttingDown ? "shutting_down" : "ok",
      uptime: process.uptime(),
    };
  }

  readinessCheck(): boolean {
    return this.isReady && !this.isShuttingDown;
  }

  onShutdown(handler: () => Promise<void>): void {
    this.shutdownHandlers.push(handler);
  }

  private async shutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    this.log.warn(`SHUTDOWN_INITIATED`, { signal });

    // Execute registered shutdown handlers
    for (const handler of this.shutdownHandlers.reverse()) {
      try {
        await handler();
      } catch (e) {
        this.log.error("SHUTDOWN_HANDLER_FAILED", { error: String(e) });
      }
    }

    this.log.info("SHUTDOWN_COMPLETE");
    // Rule 14: Use production-safe exit.
    process.exit(0);
  }
}

export const lifecycle = new LifecycleManager();
