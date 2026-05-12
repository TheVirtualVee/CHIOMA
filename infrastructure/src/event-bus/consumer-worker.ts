import type { DomainEvent } from "@chioma/core";
import { createConsoleLogger } from "../observability/logger.js";
import type { EventBus } from "@chioma/core";

const logger = createConsoleLogger("consumer-worker");

export type EventSource = {
  getSince(tenantId: string, lastPosition: number): Promise<{ event: DomainEvent, position: number }[]>;
};

export type ConsumerOffsetStore = {
  getOffset(tenantId: string, consumerGroup: string): Promise<number>;
  updateOffset(tenantId: string, consumerGroup: string, position: number): Promise<void>;
};

export type EventDispatcher = {
  dispatchLocally(event: DomainEvent): Promise<void>;
};

/** contract: EventConsumerWorker */
export class EventConsumerWorker {
  private isRunning = false;
  private currentTimeout?: NodeJS.Timeout;

  constructor(
    private readonly source: EventSource,
    private readonly offsetStore: ConsumerOffsetStore,
    private readonly localDispatcher: EventDispatcher,
    private readonly consumerGroup: string,
    private readonly tenantIds: string[],
    private readonly pollIntervalMs: number = 1000
  ) {}

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info("CONSUMER_STARTED", { group: this.consumerGroup });
    this.poll();
  }

  stop() {
    this.isRunning = false;
    if (this.currentTimeout) {
      clearTimeout(this.currentTimeout);
    }
    logger.info("CONSUMER_STOPPED", { group: this.consumerGroup });
  }

  private async poll() {
    if (!this.isRunning) return;

    try {
      for (const tenantId of this.tenantIds) {
        await this.processTenant(tenantId);
      }
    } catch (err) {
      logger.error("CONSUMER_POLL_ERROR", { group: this.consumerGroup, error: String(err) });
    } finally {
      if (this.isRunning) {
        this.currentTimeout = setTimeout(() => this.poll(), this.pollIntervalMs);
      }
    }
  }

  private async processTenant(tenantId: string) {
    const lastPosition = await this.offsetStore.getOffset(tenantId, this.consumerGroup);
    const unread = await this.source.getSince(tenantId, lastPosition);

    for (const { event, position } of unread) {
      if (!this.isRunning) break;

      try {
        /** side-effect: Dispatch to local side-effects layer */
        await this.localDispatcher.dispatchLocally(event);
        
        /** side-effect: Commit offset after successful processing */
        await this.offsetStore.updateOffset(tenantId, this.consumerGroup, position);
      } catch (err) {
        logger.error("CONSUMER_EVENT_FAILED", { 
          eventId: event.id, 
          group: this.consumerGroup, 
          position, 
          error: String(err) 
        });
        // Stop processing this tenant's queue on failure to preserve ordering
        throw err; 
      }
    }
  }
}
