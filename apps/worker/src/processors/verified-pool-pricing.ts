import { canonicalAssetRegistry, checksumAddress } from '@hood-sentry/chain';
import { type Database, DrizzlePricingRepository, schema } from '@hood-sentry/db';
import type { PriceSourceConfig } from '@hood-sentry/market-engine';
import { and, eq } from 'drizzle-orm';
import type { Address, Hash } from 'viem';
import { getAddress, isAddress, isHash } from 'viem';
import { z } from 'zod';

const addressSchema = z
  .string()
  .refine(isAddress, 'expected a 20-byte address')
  .transform((value) => getAddress(value));
const hashSchema = z.string().refine(isHash, 'expected a 32-byte hash');
const unsignedIntegerSchema = z.string().regex(/^[0-9]+$/);

export const poolMarketJobDataSchema = z.object({
  protocolKey: z.string().trim().min(1).max(100).optional(),
  protocolVersion: z.string().trim().min(1).max(100).optional(),
  poolAddress: addressSchema,
  transactionHash: hashSchema,
  logIndex: z.number().int().nonnegative(),
  eventType: z.enum([
    'swap',
    'liquidityAdded',
    'liquidityRemoved',
    'lpMinted',
    'lpBurned',
    'positionIncreased',
    'positionDecreased',
    'launchpadMigration',
  ]),
});

export interface PoolMarketIdentity {
  chainId: number;
  blockNumber: bigint;
  blockHash: Hash;
  protocolKey: string;
  protocolVersion: string;
  poolAddress: Address;
  transactionHash: Hash;
  logIndex: number;
}

export interface VerifiedPoolPricingContext {
  identity: PoolMarketIdentity;
  sourceTimestamp: string;
  tokenAddress: Address;
  quoteAddress: Address;
  tokenDecimals: number;
  quoteDecimals: number;
  reserveTokenRaw: bigint;
  reserveQuoteRaw: bigint;
  quoteTradeAmountRaw: bigint;
  config: PriceSourceConfig;
}

function parseIdentity(input: {
  chainId: string;
  blockNumber: string;
  blockHash: string;
  data: unknown;
}): PoolMarketIdentity & { data: z.infer<typeof poolMarketJobDataSchema> } {
  const data = poolMarketJobDataSchema.parse(input.data);
  const chainId = z.coerce.number().int().positive().parse(input.chainId);
  const blockNumber = BigInt(unsignedIntegerSchema.parse(input.blockNumber));
  const blockHash = hashSchema.parse(input.blockHash);
  return {
    chainId,
    blockNumber,
    blockHash,
    protocolKey: data.protocolKey ?? '',
    protocolVersion: data.protocolVersion ?? '',
    poolAddress: data.poolAddress,
    transactionHash: data.transactionHash,
    logIndex: data.logIndex,
    data,
  };
}

function selectPair(
  chainId: number,
  token0: Address,
  token1: Address,
): { tokenAddress: Address; quoteAddress: Address } | null {
  const assets = canonicalAssetRegistry.entries.filter(
    (entry) => entry.chainId === chainId && entry.enabled,
  );
  const byAddress = new Map(assets.map((entry) => [entry.address.toLowerCase(), entry]));
  const token0Asset = byAddress.get(token0.toLowerCase());
  const token1Asset = byAddress.get(token1.toLowerCase());
  if (token0Asset === undefined && token1Asset === undefined) return null;
  if (token0Asset !== undefined && token1Asset === undefined) {
    return { tokenAddress: token1, quoteAddress: token0 };
  }
  if (token0Asset === undefined && token1Asset !== undefined) {
    return { tokenAddress: token0, quoteAddress: token1 };
  }
  if (token0Asset?.key === 'usdg') return { tokenAddress: token1, quoteAddress: token0 };
  if (token1Asset?.key === 'usdg') return { tokenAddress: token0, quoteAddress: token1 };
  return null;
}

function assetClass(chainId: number, address: Address): PriceSourceConfig['assetClass'] {
  const asset = canonicalAssetRegistry.entries.find(
    (entry) => entry.chainId === chainId && entry.address.toLowerCase() === address.toLowerCase(),
  );
  if (asset?.key === 'weth') return 'wrappedEth';
  if (asset?.key === 'usdg') return 'stablecoin';
  return 'erc20';
}

function minimumLiquidity(chainId: number, quoteAddress: Address, decimals: number): bigint {
  const asset = canonicalAssetRegistry.entries.find(
    (entry) =>
      entry.chainId === chainId && entry.address.toLowerCase() === quoteAddress.toLowerCase(),
  );
  if (asset?.key === 'usdg') return 1_000n * 10n ** BigInt(decimals);
  return 1n * 10n ** BigInt(decimals);
}

function buildConfig(input: {
  identity: PoolMarketIdentity;
  tokenAddress: Address;
  quoteAddress: Address;
  quoteDecimals: number;
  verificationSource: string;
  verifiedAt: string;
}): PriceSourceConfig {
  const quoteAsset = canonicalAssetRegistry.entries.find(
    (entry) =>
      entry.chainId === input.identity.chainId &&
      entry.address.toLowerCase() === input.quoteAddress.toLowerCase(),
  );
  return {
    sourceKey: [
      'verified-pool-v1',
      input.identity.chainId,
      input.identity.poolAddress.toLowerCase(),
      input.tokenAddress.toLowerCase(),
      input.quoteAddress.toLowerCase(),
    ].join(':'),
    sourceType: quoteAsset?.key === 'usdg' ? 'stablecoinPool' : 'wethRoute',
    assetClass: assetClass(input.identity.chainId, input.tokenAddress),
    chainId: input.identity.chainId,
    sourceContractAddress: input.identity.poolAddress,
    sourceAssetAddress: input.tokenAddress,
    quoteAssetAddress: input.quoteAddress,
    verificationSourceUrl: input.verificationSource,
    verifiedAt: input.verifiedAt,
    minimumLiquidityRaw: minimumLiquidity(
      input.identity.chainId,
      input.quoteAddress,
      input.quoteDecimals,
    ),
    liquidityDecimals: input.quoteDecimals,
    maximumStalenessSeconds: 120,
    enabled: true,
    priority: quoteAsset?.key === 'usdg' ? 30 : 40,
    confidenceRules: {
      baseConfidenceBps: 9_000n,
      thinLiquidityPenaltyBps: 3_000n,
      stalePenaltyBps: 4_000n,
      disagreementThresholdBps: 1_000n,
      disagreementPenaltyBps: 2_500n,
      maximumPriceImpactBps: 1_000n,
      maximumSingleTransactionVolumeBps: 2_000n,
      maximumPriceJumpBps: 5_000n,
      stablecoinDepegThresholdBps: 500n,
      minimumAuthoritativeConfidenceBps: 7_000n,
    },
    route: [
      {
        protocolKey: input.identity.protocolKey,
        protocolVersion: input.identity.protocolVersion,
        poolAddress: input.identity.poolAddress,
        inputTokenAddress: input.tokenAddress,
        outputTokenAddress: input.quoteAddress,
      },
    ],
    methodologyVersion: 'verified-constant-product-spot-v1',
  };
}

export async function loadVerifiedPoolPricingContext(
  database: Database,
  payload: { chainId: string; blockNumber: string; blockHash: string; data: unknown },
): Promise<VerifiedPoolPricingContext | null> {
  const parsed = parseIdentity(payload);
  const identity: PoolMarketIdentity = {
    chainId: parsed.chainId,
    blockNumber: parsed.blockNumber,
    blockHash: parsed.blockHash,
    protocolKey: parsed.protocolKey,
    protocolVersion: parsed.protocolVersion,
    poolAddress: parsed.poolAddress,
    transactionHash: parsed.transactionHash,
    logIndex: parsed.logIndex,
  };
  const poolAddressKey = identity.poolAddress.toLowerCase();
  const rows = await database.db
    .select({
      token0Address: schema.pools.token0_address,
      token1Address: schema.pools.token1_address,
      poolType: schema.pools.pool_type,
      poolProtocolKey: schema.pools.protocol_key,
      poolProtocolVersion: schema.pools.protocol_version,
      verificationSource: schema.dexProtocols.verification_source,
      verificationDate: schema.dexProtocols.verification_date,
      validationExpiresAt: schema.dexProtocols.validation_expires_at,
      blockTimestamp: schema.blocks.timestamp,
      reserve0Raw: schema.poolStateSnapshots.reserve0_raw,
      reserve1Raw: schema.poolStateSnapshots.reserve1_raw,
      tokenInAddress: schema.swaps.token_in_address,
      tokenOutAddress: schema.swaps.token_out_address,
      amountInRaw: schema.swaps.amount_in_raw,
      amountOutRaw: schema.swaps.amount_out_raw,
    })
    .from(schema.pools)
    .innerJoin(schema.dexProtocols, eq(schema.pools.protocol_id, schema.dexProtocols.id))
    .innerJoin(
      schema.poolStateSnapshots,
      and(
        eq(schema.poolStateSnapshots.chain_id, schema.pools.chain_id),
        eq(schema.poolStateSnapshots.pool_address, schema.pools.address),
      ),
    )
    .leftJoin(
      schema.swaps,
      and(
        eq(schema.swaps.chain_id, schema.pools.chain_id),
        eq(schema.swaps.pool_address, schema.pools.address),
        eq(schema.swaps.block_hash, identity.blockHash.toLowerCase()),
        eq(schema.swaps.transaction_hash, identity.transactionHash.toLowerCase()),
        eq(schema.swaps.log_index, identity.logIndex),
        eq(schema.swaps.canonical, true),
      ),
    )
    .innerJoin(
      schema.blocks,
      and(
        eq(schema.blocks.chainId, BigInt(identity.chainId)),
        eq(schema.blocks.number, identity.blockNumber),
      ),
    )
    .where(
      and(
        eq(schema.pools.chain_id, identity.chainId),
        eq(schema.pools.address, poolAddressKey),
        eq(schema.pools.pool_type, 'constantProduct'),
        eq(schema.pools.canonical, true),
        eq(schema.pools.active, true),
        eq(schema.dexProtocols.enabled, true),
        eq(schema.dexProtocols.validation_status, 'active'),
        eq(schema.poolStateSnapshots.source_block_number, identity.blockNumber),
        eq(schema.poolStateSnapshots.source_block_hash, identity.blockHash.toLowerCase()),
        eq(schema.poolStateSnapshots.canonical, true),
        eq(schema.blocks.hash, identity.blockHash.toLowerCase()),
        eq(schema.blocks.canonical, true),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    const knownPool = await database.db
      .select({ address: schema.pools.address })
      .from(schema.pools)
      .where(
        and(eq(schema.pools.chain_id, identity.chainId), eq(schema.pools.address, poolAddressKey)),
      )
      .limit(1);
    if (knownPool[0] !== undefined) throw new Error('VERIFIED_POOL_PRICE_CONTEXT_NOT_READY');
    return null;
  }
  if (row.validationExpiresAt !== null && row.validationExpiresAt <= row.blockTimestamp) {
    throw new Error('VERIFIED_PROTOCOL_VALIDATION_EXPIRED');
  }
  if (
    parsed.data.eventType !== 'launchpadMigration' &&
    (row.poolProtocolKey !== parsed.data.protocolKey ||
      row.poolProtocolVersion !== parsed.data.protocolVersion)
  ) {
    throw new Error('VERIFIED_POOL_PROTOCOL_IDENTITY_MISMATCH');
  }
  identity.protocolKey = row.poolProtocolKey;
  identity.protocolVersion = row.poolProtocolVersion;
  if (row.reserve0Raw === null || row.reserve1Raw === null) {
    throw new Error('VERIFIED_POOL_RESERVES_UNAVAILABLE');
  }
  const token0 = checksumAddress(row.token0Address);
  const token1 = checksumAddress(row.token1Address);
  const pair = selectPair(identity.chainId, token0, token1);
  if (pair === null) return null;
  const tokenRows = await database.db
    .select({ address: schema.tokens.address, decimals: schema.tokens.decimals })
    .from(schema.tokens)
    .where(eq(schema.tokens.chain_id, identity.chainId));
  const decimals = new Map(
    tokenRows.map((token) => [token.address.toLowerCase(), token.decimals] as const),
  );
  const tokenDecimals = decimals.get(pair.tokenAddress.toLowerCase());
  const quoteDecimals = decimals.get(pair.quoteAddress.toLowerCase());
  if (tokenDecimals === null || tokenDecimals === undefined) {
    throw new Error('PRICE_SOURCE_TOKEN_DECIMALS_UNAVAILABLE');
  }
  if (quoteDecimals === null || quoteDecimals === undefined) {
    throw new Error('PRICE_SOURCE_QUOTE_DECIMALS_UNAVAILABLE');
  }
  const tokenIs0 = pair.tokenAddress.toLowerCase() === token0.toLowerCase();
  const reserveTokenRaw = BigInt(tokenIs0 ? row.reserve0Raw : row.reserve1Raw);
  const reserveQuoteRaw = BigInt(tokenIs0 ? row.reserve1Raw : row.reserve0Raw);
  if (
    parsed.data.eventType === 'swap' &&
    (row.tokenInAddress === null ||
      row.tokenOutAddress === null ||
      row.amountInRaw === null ||
      row.amountOutRaw === null)
  ) {
    throw new Error('VERIFIED_POOL_SWAP_CONTEXT_NOT_READY');
  }
  const tokenIn = row.tokenInAddress === null ? null : checksumAddress(row.tokenInAddress);
  const tokenOut = row.tokenOutAddress === null ? null : checksumAddress(row.tokenOutAddress);
  const quoteTradeAmountRaw =
    tokenIn?.toLowerCase() === pair.quoteAddress.toLowerCase()
      ? BigInt(row.amountInRaw ?? '0')
      : tokenOut?.toLowerCase() === pair.quoteAddress.toLowerCase()
        ? BigInt(row.amountOutRaw ?? '0')
        : 0n;
  const config = buildConfig({
    identity,
    tokenAddress: pair.tokenAddress,
    quoteAddress: pair.quoteAddress,
    quoteDecimals,
    verificationSource: row.verificationSource,
    verifiedAt: row.verificationDate.toISOString(),
  });
  await new DrizzlePricingRepository(database.db).saveSourceConfig(config);
  return {
    identity,
    sourceTimestamp: row.blockTimestamp.toISOString(),
    tokenAddress: pair.tokenAddress,
    quoteAddress: pair.quoteAddress,
    tokenDecimals,
    quoteDecimals,
    reserveTokenRaw,
    reserveQuoteRaw,
    quoteTradeAmountRaw,
    config,
  };
}
