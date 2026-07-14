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
