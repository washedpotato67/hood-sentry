import {
  type MarketMetrics,
  type MarketWindow,
  type MetricContext,
  type PriceObservation,
  type SupplyInput,
  type TradeMetricInput,
  aggregateMarketMetrics,
} from '@hood-sentry/market-engine';

export interface MetricWriter {
  saveMetrics(metrics: MarketMetrics): Promise<void>;
}

export class MarketMetricAggregationJob {
  constructor(private readonly repository: MetricWriter) {}

  async run(input: {
    chainId: number;
    tokenAddress: `0x${string}`;
    quoteAssetAddress: `0x${string}`;
    window: MarketWindow;
    asOf: string;
    quoteDecimals: number;
    observation: PriceObservation | null;
    trades: readonly TradeMetricInput[];
    supply: SupplyInput;
    context: MetricContext;
    methodologyVersion: string;
  }): Promise<{ metrics: MarketMetrics; idempotencyKey: string }> {
    const metrics = aggregateMarketMetrics(input);
    await this.repository.saveMetrics(metrics);
    return {
      metrics,
      idempotencyKey: `metrics:${metrics.chainId}:${metrics.tokenAddress}:${metrics.quoteAssetAddress}:${metrics.window}:${metrics.bucketStart}:${metrics.methodologyVersion}`,
    };
  }
}
