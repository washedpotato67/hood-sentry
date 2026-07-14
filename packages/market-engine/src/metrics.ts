import { median, mulDivFloor, ratioBps } from './arithmetic.js';
import type {
  MarketCandle,
  MarketMetrics,
  MarketWindow,
  MetricContext,
  PriceObservation,
  SupplyInput,
  TradeMetricInput,
} from './types.js';

export const MARKET_WINDOWS: Readonly<Record<MarketWindow, number>> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3_600,
  '6h': 21_600,
  '24h': 86_400,
  '7d': 604_800,
  '30d': 2_592_000,
};

function epochSeconds(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error('Invalid metric timestamp');
  return Math.floor(milliseconds / 1000);
}

export function bucketStart(value: string, window: MarketWindow): string {
  const seconds = epochSeconds(value);
  const windowSeconds = MARKET_WINDOWS[window];
  return new Date(Math.floor(seconds / windowSeconds) * windowSeconds * 1000).toISOString();
}

export function aggregateCandle(
  observations: readonly PriceObservation[],
  window: MarketWindow,
  methodologyVersion: string,
): MarketCandle | null {
  const usable = observations
    .filter((item) => item.canonical && item.priceRaw !== null && item.status !== 'unavailable')
    .sort(
      (left, right) => epochSeconds(left.sourceTimestamp) - epochSeconds(right.sourceTimestamp),
    );
  const first = usable[0];
  const last = usable.at(-1);
  if (
    first === undefined ||
    last === undefined ||
    first.priceRaw === null ||
    last.priceRaw === null
  )
    return null;
  if (usable.some((item) => item.priceDecimals !== first.priceDecimals)) {
    throw new Error('Candle observations must use one price decimal scale');
  }
  const prices = usable.flatMap((item) => (item.priceRaw === null ? [] : [item.priceRaw]));
  return {
    chainId: first.chainId,
    tokenAddress: first.tokenAddress,
    quoteAssetAddress: first.quoteAssetAddress,
    window,
    bucketStart: bucketStart(first.sourceTimestamp, window),
    priceDecimals: first.priceDecimals,
    openPriceRaw: first.priceRaw,
    highPriceRaw: prices.reduce((high, price) => (price > high ? price : high), first.priceRaw),
    lowPriceRaw: prices.reduce((low, price) => (price < low ? price : low), first.priceRaw),
    closePriceRaw: last.priceRaw,
    sourceObservationCount: BigInt(usable.length),
    canonical: true,
    methodologyVersion,
  };
}

function valuation(
  priceRaw: bigint | null,
  priceDecimals: number | null,
  supplyRaw: bigint | null,
  supplyDecimals: number,
): bigint | null {
  if (priceRaw === null || priceDecimals === null || supplyRaw === null) return null;
  return mulDivFloor(priceRaw, supplyRaw, 10n ** BigInt(supplyDecimals));
}

export function aggregateMarketMetrics(input: {
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
}): MarketMetrics {
  const trades = input.trades.filter((trade) => trade.canonical);
  const buyTrades = trades.filter((trade) => trade.side === 'buy');
  const sellTrades = trades.filter((trade) => trade.side === 'sell');
  const sum = (values: readonly bigint[]) => values.reduce((total, value) => total + value, 0n);
  const sizes = trades.map((trade) => trade.quoteAmountRaw);
  const volumeRaw = sum(sizes);
  const transactionCount = BigInt(trades.length);
  const spotPriceRaw = input.observation?.priceRaw ?? null;
  const spotPriceDecimals = input.observation?.priceDecimals ?? null;
  const reliableCirculating = input.supply.circulatingSupplyReliable
    ? input.supply.circulatingSupplyRaw
    : null;
  return {
    chainId: input.chainId,
    tokenAddress: input.tokenAddress,
    quoteAssetAddress: input.quoteAssetAddress,
    window: input.window,
    bucketStart: bucketStart(input.asOf, input.window),
    quoteDecimals: input.quoteDecimals,
    spotPriceRaw,
    spotPriceDecimals,
    volumeRaw,
    buyVolumeRaw: sum(buyTrades.map((trade) => trade.quoteAmountRaw)),
    sellVolumeRaw: sum(sellTrades.map((trade) => trade.quoteAmountRaw)),
    buyCount: BigInt(buyTrades.length),
    sellCount: BigInt(sellTrades.length),
    uniqueTraders: BigInt(new Set(trades.map((trade) => trade.traderAddress.toLowerCase())).size),
    liquidityRaw: input.context.liquidityRaw,
    liquidityDecimals: input.context.liquidityDecimals,
    marketCapitalizationRaw: valuation(
      spotPriceRaw,
      spotPriceDecimals,
      reliableCirculating,
      input.supply.supplyDecimals,
    ),
    fullyDilutedValuationRaw: valuation(
      spotPriceRaw,
      spotPriceDecimals,
      input.supply.totalSupplyRaw,
      input.supply.supplyDecimals,
    ),
    valuationDecimals: spotPriceDecimals,
    circulatingSupplyRaw: reliableCirculating,
    circulatingSupplyMethodology:
      reliableCirculating === null ? null : input.supply.circulatingSupplyMethodology,
    circulatingSupplyExclusions:
      reliableCirculating === null ? [] : input.supply.circulatingSupplyExclusions,
    priceChangeBps:
      spotPriceRaw === null || input.context.previousClosePriceRaw === null
        ? null
        : ratioBps(spotPriceRaw, input.context.previousClosePriceRaw),
    volumeChangeBps:
      input.context.previousVolumeRaw === null
        ? null
        : ratioBps(volumeRaw, input.context.previousVolumeRaw),
    liquidityChangeBps:
      input.context.liquidityRaw === null || input.context.previousLiquidityRaw === null
        ? null
        : ratioBps(input.context.liquidityRaw, input.context.previousLiquidityRaw),
    holderChange:
      input.context.holderCount === null || input.context.previousHolderCount === null
        ? null
        : input.context.holderCount - input.context.previousHolderCount,
    transactionGrowthBps:
      input.context.previousTransactionCount === null
        ? null
        : ratioBps(transactionCount, input.context.previousTransactionCount),
    averageTradeSizeRaw: transactionCount === 0n ? null : volumeRaw / transactionCount,
    medianTradeSizeRaw: median(sizes),
    whaleVolumeRaw: sum(trades.filter((trade) => trade.whale).map((trade) => trade.quoteAmountRaw)),
    priceImpactByOrderSize: input.context.priceImpactByOrderSize,
    canonical: true,
    methodologyVersion: input.methodologyVersion,
  };
}
