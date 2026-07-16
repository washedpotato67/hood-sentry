import { z } from 'zod';
import { evmAddressSchema, rawIntegerSchema } from './protocols.js';

export const marketWindowSchema = z.enum(['1m', '5m', '15m', '1h', '6h', '24h', '7d', '30d']);

export const priceQuerySchema = z.object({
  chainId: z.coerce.number().int().positive(),
  quoteAssetAddress: evmAddressSchema,
});

export const priceHistoryQuerySchema = priceQuerySchema.extend({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

export const candleQuerySchema = priceQuerySchema.extend({
  window: marketWindowSchema,
  limit: z.coerce.number().int().positive().max(1_000).default(100),
});

export const metricsQuerySchema = priceQuerySchema.extend({ window: marketWindowSchema });

export const priceResponseSchema = z.object({
  tokenAddress: evmAddressSchema,
  quoteAssetAddress: evmAddressSchema,
  priceRaw: rawIntegerSchema.nullable(),
  priceDecimals: z.number().int().nonnegative().nullable(),
  status: z.enum(['available', 'lowConfidence', 'unavailable']),
  source: z.string(),
  sourceContractAddress: evmAddressSchema.nullable(),
  sourceBlockNumber: rawIntegerSchema.nullable(),
  sourceBlockHash: z.string().nullable(),
  sourceTimestamp: z.string().datetime().nullable(),
  observedAt: z.string().datetime().nullable(),
  freshnessSeconds: rawIntegerSchema.nullable(),
  stale: z.boolean(),
  confidenceBps: rawIntegerSchema,
  warnings: z.array(z.string()),
  methodologyVersion: z.string().nullable(),
});

export const oracleSourceStatusResponseSchema = z.object({
  tokenAddress: evmAddressSchema,
  quoteAssetAddress: evmAddressSchema,
  sourceKey: z.string().nullable(),
  sourceType: z
    .enum([
      'chainlink',
      'launchpadBondingCurve',
      'stablecoinPool',
      'wethRoute',
      'directDex',
      'multihop',
      'externalProvider',
      'unavailable',
    ])
    .nullable(),
  sourceContractAddress: evmAddressSchema.nullable(),
  answerRaw: rawIntegerSchema.nullable(),
  decimals: z.number().int().nonnegative().nullable(),
  updatedAt: z.string().datetime().nullable(),
  heartbeatSeconds: z.number().int().positive().nullable(),
  sequencerUp: z.boolean().nullable(),
  oraclePaused: z.boolean().nullable(),
  roundId: rawIntegerSchema.nullable(),
  answeredInRound: rawIntegerSchema.nullable(),
  status: z.enum(['available', 'lowConfidence', 'unavailable']),
  reasons: z.array(z.string()),
});
