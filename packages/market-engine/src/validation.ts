import { getAddress, zeroAddress } from 'viem';
import { z } from 'zod';
import type { PriceSourceConfig } from './types.js';

const addressSchema = z.string().transform((value, context) => {
  try {
    return getAddress(value);
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid EVM address' });
    return z.NEVER;
  }
});

const rawIntegerSchema = z.string().regex(/^\d+$/).transform(BigInt);

export const priceSourceConfigSchema = z.object({
  sourceKey: z.string().min(1).max(100),
  sourceType: z.enum([
    'chainlink',
    'launchpadBondingCurve',
    'stablecoinPool',
    'wethRoute',
    'directDex',
    'multihop',
    'externalProvider',
    'unavailable',
  ]),
  assetClass: z.enum(['erc20', 'wrappedEth', 'stablecoin', 'launchpad', 'migratedLaunchpad']),
  chainId: z.number().int().positive(),
  sourceContractAddress: addressSchema.nullable(),
  sourceAssetAddress: addressSchema,
  quoteAssetAddress: addressSchema,
  verificationSourceUrl: z.string().url(),
  verifiedAt: z.string().datetime(),
  minimumLiquidityRaw: rawIntegerSchema,
  liquidityDecimals: z.number().int().min(0).max(255),
  maximumStalenessSeconds: z.number().int().positive(),
  enabled: z.boolean(),
  priority: z.number().int().nonnegative(),
  confidenceRules: z.object({
    baseConfidenceBps: rawIntegerSchema,
    thinLiquidityPenaltyBps: rawIntegerSchema,
    stalePenaltyBps: rawIntegerSchema,
    disagreementThresholdBps: rawIntegerSchema,
    disagreementPenaltyBps: rawIntegerSchema,
    maximumPriceImpactBps: rawIntegerSchema,
    maximumSingleTransactionVolumeBps: rawIntegerSchema,
    maximumPriceJumpBps: rawIntegerSchema,
    stablecoinDepegThresholdBps: rawIntegerSchema,
    minimumAuthoritativeConfidenceBps: rawIntegerSchema,
  }),
  route: z.array(
    z.object({
      protocolKey: z.string().min(1),
      protocolVersion: z.string().min(1),
      poolAddress: addressSchema,
      inputTokenAddress: addressSchema,
      outputTokenAddress: addressSchema,
    }),
  ),
  methodologyVersion: z.string().min(1),
});

export function parsePriceSourceConfig(input: unknown): PriceSourceConfig {
  const parsed = priceSourceConfigSchema.parse(input);
  return parsed;
}

export function validateSourceRegistry(configs: readonly PriceSourceConfig[]): void {
  const keys = new Set<string>();
  for (const config of configs) {
    priceSourceConfigSchema.parse({
      ...config,
      minimumLiquidityRaw: config.minimumLiquidityRaw.toString(),
      confidenceRules: Object.fromEntries(
        Object.entries(config.confidenceRules).map(([key, value]) => [key, value.toString()]),
      ),
    });
    if (keys.has(config.sourceKey)) throw new Error(`Duplicate price source: ${config.sourceKey}`);
    keys.add(config.sourceKey);
    if (
      config.sourceAssetAddress.toLowerCase() === zeroAddress ||
      config.quoteAssetAddress.toLowerCase() === zeroAddress ||
      config.sourceContractAddress?.toLowerCase() === zeroAddress
    ) {
      throw new Error(`Price source contains a zero address: ${config.sourceKey}`);
    }
    if (
      config.enabled &&
      config.sourceType !== 'externalProvider' &&
      config.sourceContractAddress === null
    ) {
      throw new Error(
        `Enabled on-chain price source lacks a verified contract: ${config.sourceKey}`,
      );
    }
    if (config.confidenceRules.baseConfidenceBps > 10_000n) {
      throw new Error(`Price source confidence exceeds 10000 bps: ${config.sourceKey}`);
    }
    if (config.sourceType === 'unavailable' && config.enabled) {
      throw new Error(`Unavailable source cannot be enabled: ${config.sourceKey}`);
    }
  }
}
