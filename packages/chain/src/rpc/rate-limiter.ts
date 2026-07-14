import type { RateLimiterConfig } from './types.js';
import { RateLimitError } from './types.js';

export class RateLimiter {
  private tokens: number;
  private lastRefillTime: number;
  private readonly requestsPerSecond: number;
  private readonly burstSize: number;
  private readonly providerUrl: string;

  constructor(providerUrl: string, config: RateLimiterConfig) {
    this.providerUrl = providerUrl;
    this.requestsPerSecond = config.requestsPerSecond;
    this.burstSize = config.burstSize ?? config.requestsPerSecond;
    this.tokens = this.burstSize;
    this.lastRefillTime = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // Calculate wait time for next token
    const waitTimeMs = (1 - this.tokens) * (1000 / this.requestsPerSecond);

    throw new RateLimitError(this.providerUrl, waitTimeMs);
  }

  async waitForToken(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // Wait for next token
    const waitTimeMs = Math.ceil((1 - this.tokens) * (1000 / this.requestsPerSecond));
    await this.sleep(waitTimeMs);

    this.refill();
    this.tokens -= 1;
  }

  private refill(): void {
    const now = Date.now();
    const timePassed = (now - this.lastRefillTime) / 1000; // Convert to seconds
    const tokensToAdd = timePassed * this.requestsPerSecond;

    this.tokens = Math.min(this.burstSize, this.tokens + tokensToAdd);
    this.lastRefillTime = now;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }

  getConfig(): RateLimiterConfig {
    return {
      requestsPerSecond: this.requestsPerSecond,
      burstSize: this.burstSize,
    };
  }

  getProviderUrl(): string {
    return this.providerUrl;
  }

  reset(): void {
    this.tokens = this.burstSize;
    this.lastRefillTime = Date.now();
  }
}
