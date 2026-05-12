/**
 * Production-ready Circuit Breaker.
 * Enforces Priority 5: Failure containment for external integrations.
 */
export enum CircuitState {
  CLOSED,
  OPEN,
  HALF_OPEN,
}

export type CircuitBreakerOptions = {
  failureThreshold: number;
  resetTimeoutMs: number;
};

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private lastFailureTime = 0;

  constructor(private readonly options: CircuitBreakerOptions) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime > this.options.resetTimeoutMs) {
        this.state = CircuitState.HALF_OPEN;
      } else {
        throw new Error("CIRCUIT_OPEN: External service unavailable (failure threshold exceeded)");
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failures = 0;
    this.state = CircuitState.CLOSED;
  }

  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.options.failureThreshold) {
      this.state = CircuitState.OPEN;
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}
