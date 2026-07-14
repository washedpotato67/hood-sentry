import { z } from 'zod';
import { marketWindowSchema } from './prices.js';
import { evmAddressSchema, rawIntegerSchema } from './protocols.js';

export const marketCandleSchema = z.object({
  chainId: z.number().int().positive(),
  tokenAddress: evmAddressSchema,
  quoteAssetAddress: evmAddressSchema,
  window: marketWindowSchema,
  bucketStart: z.string().datetime(),
  priceDecimals: z.number().int().nonnegative(),
  openPriceRaw: rawIntegerSchema,
  highPriceRaw: rawIntegerSchema,
  lowPriceRaw: rawIntegerSchema,
  closePriceRaw: rawIntegerSchema,
  sourceObservationCount: rawIntegerSchema,
  canonical: z.boolean(),
  methodologyVersion: z.string(),
});

export const marketMetricsSchema = z.object({
  chainId: z.number().int().positive(),
  tokenAddress: evmAddressSchema,
  quoteAssetAddress: evmAddressSchema,
  window: marketWindowSchema,
  bucketStart: z.string().datetime(),
  spotPriceRaw: rawIntegerSchema.nullable(),
  marketCapitalizationRaw: rawIntegerSchema.nullable(),
  fullyDilutedValuationRaw: rawIntegerSchema.nullable(),
  liquidityRaw: rawIntegerSchema.nullable(),
  volumeRaw: rawIntegerSchema,
  methodologyVersion: z.string(),
});
