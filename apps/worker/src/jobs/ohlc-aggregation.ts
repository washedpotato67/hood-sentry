import {
  MARKET_WINDOWS,
  type MarketCandle,
  type MarketWindow,
  type PriceObservation,
  aggregateCandle,
} from '@hood-sentry/market-engine';

export interface CandleWriter {
  saveCandle(candle: MarketCandle): Promise<void>;
}

export class OhlcAggregationJob {
  constructor(private readonly repository: CandleWriter) {}

  async run(input: {
    observations: readonly PriceObservation[];
    window: MarketWindow;
    methodologyVersion: string;
  }): Promise<{ candle: MarketCandle | null; idempotencyKey: string }> {
    if (MARKET_WINDOWS[input.window] === undefined) throw new Error('Unsupported market window');
    const candle = aggregateCandle(input.observations, input.window, input.methodologyVersion);
    if (candle !== null) await this.repository.saveCandle(candle);
    const identity =
      candle === null ? 'empty' : `${candle.chainId}:${candle.tokenAddress}:${candle.bucketStart}`;
    return {
      candle,
      idempotencyKey: `ohlc:${input.window}:${identity}:${input.methodologyVersion}`,
    };
  }
}
