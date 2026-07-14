import { getAddress, isAddress, isHash } from 'viem';
import { z } from 'zod';

export const evmAddressSchema = z
  .string()
  .refine(isAddress, 'Invalid EVM address')
  .transform((address) => getAddress(address));
export const chainHashSchema = z.string().refine(isHash, 'Invalid chain hash');
export const rawIntegerSchema = z.string().regex(/^\d+$/);

export const protocolSummarySchema = z.object({
  chainId: z.number().int().positive(),
  protocolKey: z.string(),
  protocolName: z.string(),
  protocolVersion: z.string(),
  kind: z.enum(['dex', 'launchpad']),
  enabled: z.boolean(),
  validationStatus: z.enum(['active', 'disabled', 'failed']),
  validatedAt: z.string().datetime().nullable(),
  validationExpiresAt: z.string().datetime().nullable(),
});

export const protocolVerificationSchema = z.object({
  chainId: z.number().int().positive(),
  protocolKey: z.string(),
  protocolVersion: z.string(),
  contractRole: z.string(),
  address: evmAddressSchema,
  expectedRuntimeBytecodeHash: chainHashSchema,
  observedRuntimeBytecodeHash: chainHashSchema.nullable(),
  valid: z.boolean(),
  failureCode: z.string().nullable(),
  errors: z.array(z.string()),
  checkedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export const normalizedPoolResponseSchema = z.object({
  chainId: z.number().int().positive(),
  protocolKey: z.string(),
  protocolVersion: z.string(),
  poolAddress: evmAddressSchema,
  factoryAddress: evmAddressSchema,
  token0Address: evmAddressSchema,
  token1Address: evmAddressSchema,
  feeTier: rawIntegerSchema.optional(),
  tickSpacing: z.number().int().optional(),
  poolType: z.enum([
    'constantProduct',
    'concentratedLiquidity',
    'stableSwap',
    'bondingCurve',
    'rfq',
    'unknown',
  ]),
  createdBlockNumber: rawIntegerSchema,
  createdBlockHash: chainHashSchema,
  creationTransactionHash: chainHashSchema,
  creationLogIndex: z.number().int().nonnegative(),
  canonical: z.boolean(),
});

export const normalizedSwapResponseSchema = z.object({
  chainId: z.number().int().positive(),
  protocolKey: z.string(),
  protocolVersion: z.string(),
  poolAddress: evmAddressSchema,
  transactionHash: chainHashSchema,
  blockNumber: rawIntegerSchema,
  blockHash: chainHashSchema,
  logIndex: z.number().int().nonnegative(),
  senderAddress: evmAddressSchema.optional(),
  recipientAddress: evmAddressSchema.optional(),
  tokenInAddress: evmAddressSchema,
  tokenOutAddress: evmAddressSchema,
  amountInRaw: rawIntegerSchema,
  amountOutRaw: rawIntegerSchema,
  feeRaw: rawIntegerSchema.optional(),
  canonical: z.boolean(),
});

export const normalizedLiquidityResponseSchema = z.object({
  chainId: z.number().int().positive(),
  protocolKey: z.string(),
  protocolVersion: z.string(),
  eventType: z.string(),
  poolAddress: evmAddressSchema,
  ownerAddress: evmAddressSchema.optional(),
  providerAddress: evmAddressSchema.optional(),
  recipientAddress: evmAddressSchema.optional(),
  token0Address: evmAddressSchema,
  token1Address: evmAddressSchema,
  amount0Raw: rawIntegerSchema,
  amount1Raw: rawIntegerSchema,
  positionId: rawIntegerSchema.optional(),
  tickLower: z.number().int().optional(),
  tickUpper: z.number().int().optional(),
  blockNumber: rawIntegerSchema,
  blockHash: chainHashSchema,
  transactionHash: chainHashSchema,
  logIndex: z.number().int().nonnegative(),
  canonical: z.boolean(),
});

export const launchpadTokenResponseSchema = z.object({
  chainId: z.number().int().positive(),
  protocolKey: z.string(),
  protocolVersion: z.string(),
  tokenAddress: evmAddressSchema,
  creatorAddress: evmAddressSchema,
  tokenImplementationAddress: evmAddressSchema.optional(),
  initialSupplyRaw: rawIntegerSchema,
  bondingCurveAddress: evmAddressSchema.optional(),
  blockNumber: rawIntegerSchema,
  blockHash: chainHashSchema,
  transactionHash: chainHashSchema,
  logIndex: z.number().int().nonnegative(),
  canonical: z.boolean(),
});

export const launchpadTradeResponseSchema = z.object({
  chainId: z.number().int().positive(),
  protocolKey: z.string(),
  protocolVersion: z.string(),
  tokenAddress: evmAddressSchema,
  bondingCurveAddress: evmAddressSchema,
  traderAddress: evmAddressSchema,
  side: z.enum(['buy', 'sell']),
  tokenAmountRaw: rawIntegerSchema,
  paymentAmountRaw: rawIntegerSchema,
  creatorFeeRaw: rawIntegerSchema.optional(),
  protocolFeeRaw: rawIntegerSchema.optional(),
  blockNumber: rawIntegerSchema,
  blockHash: chainHashSchema,
  transactionHash: chainHashSchema,
  logIndex: z.number().int().nonnegative(),
  canonical: z.boolean(),
});

export const launchpadGraduationResponseSchema = z.object({
  chainId: z.number().int().positive(),
  protocolKey: z.string(),
  protocolVersion: z.string(),
  tokenAddress: evmAddressSchema,
  bondingCurveAddress: evmAddressSchema,
  graduationThresholdRaw: rawIntegerSchema.optional(),
  blockNumber: rawIntegerSchema,
  blockHash: chainHashSchema,
  transactionHash: chainHashSchema,
  logIndex: z.number().int().nonnegative(),
  canonical: z.boolean(),
});

export const launchpadMigrationResponseSchema = z.object({
  chainId: z.number().int().positive(),
  protocolKey: z.string(),
  protocolVersion: z.string(),
  tokenAddress: evmAddressSchema,
  migrationAddress: evmAddressSchema,
  destinationProtocolKey: z.string(),
  destinationPoolAddress: evmAddressSchema,
  tokenLiquidityRaw: rawIntegerSchema.optional(),
  pairedLiquidityRaw: rawIntegerSchema.optional(),
  blockNumber: rawIntegerSchema,
  blockHash: chainHashSchema,
  transactionHash: chainHashSchema,
  logIndex: z.number().int().nonnegative(),
  canonical: z.boolean(),
});

export const launchpadStateResponseSchema = z.object({
  token: launchpadTokenResponseSchema,
  graduation: launchpadGraduationResponseSchema.nullable(),
  migration: launchpadMigrationResponseSchema.nullable(),
});

export const protocolListResponseSchema = z.object({ data: z.array(protocolSummarySchema) });
export const protocolVerificationListResponseSchema = z.object({
  data: z.array(protocolVerificationSchema),
});

export type ProtocolSummaryResponse = z.infer<typeof protocolSummarySchema>;
export type ProtocolVerificationResponse = z.infer<typeof protocolVerificationSchema>;
