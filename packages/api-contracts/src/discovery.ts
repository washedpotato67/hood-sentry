import { z } from 'zod';
import { evmAddressSchema, rawIntegerSchema } from './protocols.js';

export const discoveryFeedSchema = z.enum([
  'newTokens',
  'newPools',
  'trending',
  'volumeGainers',
  'liquidityGainers',
  'holderGainers',
  'transactionActivityGainers',
  'newlyGraduated',
  'recentlyMigrated',
  'recentlyVerifiedProjects',
  'recentlyScanned',
  'recentCriticalRisk',
  'canonicalStockTokens',
  'canonicalEtfTokens',
  'mostWatched',
  'mostAlerted',
]);

export const riskGradeSchema = z.enum(['A', 'B', 'C', 'D', 'F', 'unavailable']);
export const canonicalStateSchema = z.enum(['canonical', 'nonCanonical', 'unknown']);

const commaSeparated = z
  .string()
  .transform((value) => value.split(',').filter((part) => part.length > 0));

export const discoveryQuerySchema = z.object({
  chainId: z.coerce.number().int().positive(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional(),
  sponsoredCursor: z.string().min(1).optional(),
  maximumTokenAgeSeconds: rawIntegerSchema.optional(),
  maximumPoolAgeSeconds: rawIntegerSchema.optional(),
  minimumLiquidityRaw: rawIntegerSchema.optional(),
  minimumVolumeRaw: rawIntegerSchema.optional(),
  minimumHolders: rawIntegerSchema.optional(),
  riskGrades: commaSeparated.pipe(z.array(riskGradeSchema)).optional(),
  minimumRiskCompletenessBps: rawIntegerSchema.optional(),
  projectVerified: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  canonicalState: canonicalStateSchema.optional(),
  protocolKey: z.string().min(1).optional(),
  launchpadKey: z.string().min(1).optional(),
  quoteAssetAddress: evmAddressSchema.optional(),
  migrationStatus: z.enum(['migrated', 'notMigrated']).optional(),
  graduationStatus: z.enum(['graduated', 'notGraduated']).optional(),
  stockTokenCategory: z.string().min(1).optional(),
  etfCategory: z.string().min(1).optional(),
  maximumDataAgeSeconds: rawIntegerSchema.optional(),
});

export const discoverySearchQuerySchema = discoveryQuerySchema
  .pick({
    chainId: true,
    limit: true,
    cursor: true,
  })
  .extend({ query: z.string().trim().min(1).max(128) });

export const trendingComponentResponseSchema = z.object({
  key: z.string(),
  kind: z.enum(['positive', 'penalty']),
  rawValue: rawIntegerSchema.nullable(),
  normalizedBps: rawIntegerSchema,
  weightBps: rawIntegerSchema,
  contributionBps: rawIntegerSchema,
  available: z.boolean(),
  reasons: z.array(z.string()),
});

export const discoveryItemResponseSchema = z
  .object({
    name: z.string().nullable(),
    symbol: z.string().nullable(),
    address: evmAddressSchema,
    chainId: z.number().int().positive(),
    priceRaw: rawIntegerSchema.nullable(),
    priceDecimals: z.number().int().nonnegative().nullable(),
    priceStatus: z.enum(['available', 'lowConfidence', 'unavailable']),
    liquidityRaw: rawIntegerSchema.nullable(),
    volumeRaw: rawIntegerSchema.nullable(),
    holderCount: rawIntegerSchema.nullable(),
    riskGrade: riskGradeSchema,
    riskCompletenessBps: rawIntegerSchema.nullable(),
    projectVerified: z.boolean(),
    canonicalState: canonicalStateSchema,
    launchpadState: z.enum(['none', 'bondingCurve', 'graduated', 'migrated']),
    trending: z
      .object({
        methodologyVersion: z.string(),
        scoreBps: rawIntegerSchema,
        confidenceBps: rawIntegerSchema,
        components: z.array(trendingComponentResponseSchema),
      })
      .passthrough(),
    dataFreshnessSeconds: rawIntegerSchema,
    warnings: z.array(z.string()),
  })
  .passthrough();
