import type { RetryOptions } from './types.js';
import { ContractRevertError, RPCError, RateLimitError } from './types.js';

export interface RetryPolicyConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterEnabled: boolean;
}

export class RetryPolicy {
  private readonly config: RetryPolicyConfig;

  constructor(config: Partial<RetryPolicyConfig> = {}) {
    this.config = {
      maxAttempts: config.maxAttempts ?? 3,
      baseDelayMs: config.baseDelayMs ?? 1000,
      maxDelayMs: config.maxDelayMs ?? 30000,
      backoffMultiplier: config.backoffMultiplier ?? 2,
      jitterEnabled: config.jitterEnabled ?? true,
    };
  }

  async execute<T>(operation: () => Promise<T>, options?: RetryOptions): Promise<T> {
    const maxAttempts = options?.maxAttempts ?? this.config.maxAttempts;
    const baseDelayMs = options?.baseDelayMs ?? this.config.baseDelayMs;
    const maxDelayMs = options?.maxDelayMs ?? this.config.maxDelayMs;
    const backoffMultiplier = options?.backoffMultiplier ?? this.config.backoffMultiplier;
    const shouldRetry = options?.shouldRetry ?? this.defaultShouldRetry;

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = this.normalizeError(error);

        if (!shouldRetry(lastError)) {
          throw lastError;
        }

        if (attempt < maxAttempts) {
          const delayMs = this.calculateDelay(
            attempt,
            baseDelayMs,
            maxDelayMs,
            backoffMultiplier,
            lastError,
          );
          await this.sleep(delayMs);
        }
      }
    }

    throw lastError ?? new Error('All retry attempts failed');
  }

  private normalizeError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }

  private calculateDelay(
    attempt: number,
    baseDelayMs: number,
    maxDelayMs: number,
    backoffMultiplier: number,
    error: Error,
  ): number {
    // Check for rate limit with retry-after header
    if (error instanceof RateLimitError && error.retryAfterMs !== undefined) {
      return Math.min(error.retryAfterMs, maxDelayMs);
    }

    // Calculate exponential backoff
    const exponentialDelay = baseDelayMs * backoffMultiplier ** (attempt - 1);
    const boundedDelay = Math.min(exponentialDelay, maxDelayMs);

    // Add jitter to prevent thundering herd
    if (this.config.jitterEnabled) {
      const jitter = boundedDelay * 0.1 * Math.random(); // 10% jitter
      return boundedDelay + jitter;
    }

    return boundedDelay;
  }

  private defaultShouldRetry(error: Error): boolean {
    // Don't retry contract reverts - they're deterministic failures
    if (error instanceof ContractRevertError) {
      return false;
    }

    // Retry RPC errors that are marked as retryable
    if (error instanceof RPCError) {
      return error.isRetryable;
    }

    // Retry network errors (case-insensitive)
    const message = error.message.toLowerCase();
    if (
      message.includes('econnrefused') ||
      message.includes('etimedout') ||
      message.includes('enotfound') ||
      message.includes('econnreset') ||
      message.includes('network') ||
      message.includes('timeout')
    ) {
      return true;
    }

    // Don't retry by default
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getConfig(): RetryPolicyConfig {
    return { ...this.config };
  }
}
