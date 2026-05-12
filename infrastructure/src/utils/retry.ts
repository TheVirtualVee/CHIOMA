/**
 * Bounded exponential backoff retry utility.
 * Enforces Phase A Rule 2: No infinite loops, no silent retries.
 */
export type RetryOptions = {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  factor: number;
  onRetry?: (error: unknown, attempt: number, delay: number) => void;
};

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 3000,
  factor: 2,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let attempt = 0;
  let delay = opts.initialDelayMs;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      if (attempt > opts.maxRetries) {
        throw error;
      }
      
      if (opts.onRetry) {
        opts.onRetry(error, attempt, delay);
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
      
      delay = Math.min(delay * opts.factor, opts.maxDelayMs);
    }
  }
}
