import type {
  MarketCandle,
  MarketMetrics,
  MarketWindow,
  PriceObservation,
  PriceSourceConfig,
} from '@hood-sentry/market-engine';

export interface PricingRepository {
  saveSourceConfig(config: PriceSourceConfig): Promise<void>;
  listSourceConfigs(chainId: number, tokenAddress?: string): Promise<readonly PriceSourceConfig[]>;
  saveObservation(observation: PriceObservation): Promise<void>;
  getCurrentPrice(
    chainId: number,
    tokenAddress: string,
    quoteAssetAddress: string,
  ): Promise<PriceObservation | null>;
  findLatestOracleStatus(
    chainId: number,
    tokenAddress: string,
    quoteAssetAddress: string,
  ): Promise<PriceObservation | null>;
  getPriceHistory(
    chainId: number,
    tokenAddress: string,
    quoteAssetAddress: string,
    from: Date,
    to: Date,
  ): Promise<readonly PriceObservation[]>;
  saveCandle(candle: MarketCandle): Promise<void>;
  getCandles(
    chainId: number,
    tokenAddress: string,
    quoteAssetAddress: string,
    window: MarketWindow,
    limit: number,
  ): Promise<readonly MarketCandle[]>;
  saveMetrics(metrics: MarketMetrics): Promise<void>;
  getLatestMetrics(
    chainId: number,
    tokenAddress: string,
    quoteAssetAddress: string,
    window: MarketWindow,
  ): Promise<MarketMetrics | null>;
  markStaleSources(observedBefore: Date): Promise<number>;
  markPricingNonCanonical(chainId: number, fromBlock: bigint, toBlock: bigint): Promise<void>;
}
