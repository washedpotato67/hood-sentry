import type { MarketWindow } from '@hood-sentry/market-engine';

export interface HistoricalRecomputationProcessor {
  recompute(input: {
    chainId: number;
    tokenAddress: `0x${string}`;
    fromBlock: bigint;
    toBlock: bigint;
    windows: readonly MarketWindow[];
    methodologyVersion: string;
  }): Promise<void>;
}

export class HistoricalRecomputationJob {
  constructor(private readonly processor: HistoricalRecomputationProcessor) {}

  async run(input: {
    chainId: number;
    tokenAddress: `0x${string}`;
    fromBlock: bigint;
    toBlock: bigint;
    windows: readonly MarketWindow[];
    methodologyVersion: string;
  }): Promise<{ idempotencyKey: string }> {
    if (input.toBlock < input.fromBlock) throw new Error('Historical range is invalid');
    await this.processor.recompute(input);
    return {
      idempotencyKey: `historical:${input.chainId}:${input.tokenAddress}:${input.fromBlock.toString()}:${input.toBlock.toString()}:${input.methodologyVersion}`,
    };
  }
}
