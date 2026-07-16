import { z } from 'zod';

export const MARKET_PRICE_RELIABILITY_SOURCE = 'market_price_reliability';
export const MARKET_TRADE_MANIPULATION_SOURCE = 'market_trade_manipulation';

export const MARKET_INTEGRITY_SIGNAL_CODES = [
  'SELF_TRADING',
  'REPEATED_WALLET_PAIR',
  'ONE_WALLET_VOLUME_CONCENTRATION',
  'CIRCULAR_WALLET_VOLUME',
  'RAPID_BUY_SELL_LOOP',
  'TINY_TRADE_COUNT_INFLATION',
  'THIN_POOL_PRICE_MANIPULATION',
] as const;
export type MarketIntegritySignalCode = (typeof MARKET_INTEGRITY_SIGNAL_CODES)[number];

const schema = z.object({
  priceReliability: z.object({
    available: z.boolean(),
    activeSourceCount: z.number().int().nonnegative(),
    disagreementSourceKeys: z.array(z.string()),
    outlierReasons: z.array(z.string()),
    oneTransactionManipulation: z.boolean(),
  }),
  tradeManipulation: z.object({
    available: z.boolean(),
    tradeCount: z.number().int().nonnegative(),
    minTradesForAssessment: z.number().int().nonnegative(),
    observedSignalCodes: z.array(z.string()),
    insufficientSignalCodes: z.array(z.string()),
    methodologyVersion: z.string(),
  }),
  sourceBlock: z.string().regex(/^\d+$/),
});

export type SerializedMarketIntegrityResult = z.input<typeof schema>;

export interface MarketIntegrityResult {
  readonly priceReliability: {
    readonly available: boolean;
    readonly activeSourceCount: number;
    readonly disagreementSourceKeys: readonly string[];
    readonly outlierReasons: readonly string[];
    readonly oneTransactionManipulation: boolean;
  };
  readonly tradeManipulation: {
    readonly available: boolean;
    readonly tradeCount: number;
    readonly minTradesForAssessment: number;
    readonly observedSignalCodes: readonly string[];
    /**
     * Signal codes the manipulation analyzer could not assess at this block
     * (its required inputs were missing — e.g. thin-pool with no liquidity
     * reading). The rules map these to `unknown` rather than reporting a
     * confident `pass` on a check that never actually ran.
     */
    readonly insufficientSignalCodes: readonly string[];
    readonly methodologyVersion: string;
  };
  readonly sourceBlock: bigint;
}

export function serializeMarketIntegrityResult(
  r: MarketIntegrityResult,
): SerializedMarketIntegrityResult {
  return {
    priceReliability: {
      available: r.priceReliability.available,
      activeSourceCount: r.priceReliability.activeSourceCount,
      disagreementSourceKeys: [...r.priceReliability.disagreementSourceKeys],
      outlierReasons: [...r.priceReliability.outlierReasons],
      oneTransactionManipulation: r.priceReliability.oneTransactionManipulation,
    },
    tradeManipulation: {
      available: r.tradeManipulation.available,
      tradeCount: r.tradeManipulation.tradeCount,
      minTradesForAssessment: r.tradeManipulation.minTradesForAssessment,
      observedSignalCodes: [...r.tradeManipulation.observedSignalCodes],
      insufficientSignalCodes: [...r.tradeManipulation.insufficientSignalCodes],
      methodologyVersion: r.tradeManipulation.methodologyVersion,
    },
    sourceBlock: r.sourceBlock.toString(),
  };
}

export function deserializeMarketIntegrityResult(v: unknown): MarketIntegrityResult {
  const parsed = schema.parse(v);
  return { ...parsed, sourceBlock: BigInt(parsed.sourceBlock) };
}
