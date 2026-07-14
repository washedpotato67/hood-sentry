import type { BlockscoutRateLimitGate } from './types.js';

export class BlockscoutRateLimiter implements BlockscoutRateLimitGate {
  private nextRequestAt = 0;
  private queue: Promise<void> = Promise.resolve();
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    requestsPerSecond: number,
    options: {
      now?: () => number;
      sleep?: (milliseconds: number) => Promise<void>;
    } = {},
  ) {
    if (!Number.isFinite(requestsPerSecond) || requestsPerSecond <= 0) {
      throw new Error('Blockscout requests per second must be greater than zero');
    }

    this.intervalMs = Math.ceil(1000 / requestsPerSecond);
    this.now = options.now ?? Date.now;
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  acquire(): Promise<void> {
    const request = this.queue.then(async () => {
      const waitMs = Math.max(0, this.nextRequestAt - this.now());
      if (waitMs > 0) {
        await this.sleep(waitMs);
      }
      this.nextRequestAt = Math.max(this.nextRequestAt, this.now()) + this.intervalMs;
    });

    this.queue = request.catch(() => undefined);
    return request;
  }
}
