import { z } from 'zod';
import type { ExternalPriceInput, PriceSourceConfig } from './types.js';

export interface SourceContractVerification {
  verified: boolean;
  checkedAt: string;
  reason: string | null;
}

export interface SourceContractVerifier {
  verify(config: PriceSourceConfig): Promise<SourceContractVerification>;
}

export interface ActivatedPriceSource {
  config: PriceSourceConfig;
  active: boolean;
  checkedAt: string;
  reason: string | null;
}

export class PriceSourceActivationService {
  constructor(private readonly verifier: SourceContractVerifier) {}

  async validate(configs: readonly PriceSourceConfig[]): Promise<readonly ActivatedPriceSource[]> {
    const results: ActivatedPriceSource[] = [];
    for (const config of configs) {
      if (!config.enabled) {
        results.push({
          config,
          active: false,
          checkedAt: config.verifiedAt,
          reason: 'SOURCE_DISABLED',
        });
        continue;
      }
      const verification = await this.verifier.verify(config);
      results.push({
        config,
        active: verification.verified,
        checkedAt: verification.checkedAt,
        reason: verification.verified
          ? null
          : (verification.reason ?? 'SOURCE_VERIFICATION_FAILED'),
      });
    }
    return results;
  }
}

export interface RateLimiter {
  acquire(): Promise<void>;
}

export class FixedWindowRateLimiter implements RateLimiter {
  private windowStartedAt: number;
  private used = 0;

  constructor(
    private readonly maximumRequests: number,
    private readonly windowMilliseconds: number,
    private readonly now: () => number = Date.now,
  ) {
    if (maximumRequests <= 0 || windowMilliseconds <= 0) {
      throw new Error('Rate-limit configuration must be positive');
    }
    this.windowStartedAt = now();
  }

  async acquire(): Promise<void> {
    const current = this.now();
    if (current - this.windowStartedAt >= this.windowMilliseconds) {
      this.windowStartedAt = current;
      this.used = 0;
    }
    if (this.used >= this.maximumRequests) throw new Error('EXTERNAL_PROVIDER_RATE_LIMITED');
    this.used += 1;
  }
}

export interface ExternalMarketDataTransport {
  fetchPrice(input: {
    providerName: string;
    chainId: number;
    tokenAddress: `0x${string}`;
    quoteAssetAddress: `0x${string}`;
  }): Promise<unknown>;
}

const externalResponseSchema = z.object({
  priceRaw: z
    .string()
    .regex(/^-?\d+$/)
    .transform(BigInt),
  priceDecimals: z.number().int().min(0).max(255),
  providerTimestamp: z.string().datetime(),
});

export class ExternalMarketDataClient {
  constructor(
    private readonly providerName: string,
    private readonly transport: ExternalMarketDataTransport,
    private readonly rateLimiter: RateLimiter,
  ) {}

  async getPrice(input: {
    chainId: number;
    tokenAddress: `0x${string}`;
    quoteAssetAddress: `0x${string}`;
  }): Promise<ExternalPriceInput> {
    await this.rateLimiter.acquire();
    const response = externalResponseSchema.parse(
      await this.transport.fetchPrice({ providerName: this.providerName, ...input }),
    );
    return { ...response, providerName: this.providerName };
  }
}
