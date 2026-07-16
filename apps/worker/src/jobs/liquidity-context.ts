import type {
  DexAdapter,
  NormalizedPool,
  NormalizedPoolState,
  ProtocolAdapter,
  ProtocolAdapterManager,
} from '@hood-sentry/chain';
import { FEE_DENOMINATOR, canonicalAssetRegistry } from '@hood-sentry/chain';
import { type Database, type ProtocolRepository, schema } from '@hood-sentry/db';
import {
  denormalizeQuoteAmount,
  normalizeQuoteAmount,
  pow10,
  quoteConstantProductSwap,
} from '@hood-sentry/market-engine';
import {
  LIQUIDITY_STATE_SOURCE,
  type LiquidityOwnership,
  type LiquidityPoolEvidence,
  type LiquidityRiskInput,
  type RiskDataSource,
  type RiskScanContext,
  type StandardTradeImpact,
  analyzeLiquidityRisk,
} from '@hood-sentry/risk-engine';
import { and, asc, desc, eq, gt, isNotNull, lte, sql } from 'drizzle-orm';
import { getAddress, isHash } from 'viem';
import type { Address, Hash } from 'viem';
import { z } from 'zod';
import type { RiskContextLoader, RiskScanJobInput } from './risk-scan.js';

const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const WORD = /^0x[0-9a-fA-F]{64}$/;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';
const LIQUIDITY_TARGETS = new Set(['token', 'launchpad_token', 'pool']);
const STANDARD_TRADE_SIZE_UNITS = [100n, 1_000n, 10_000n] as const;
const PRIMARY_STANDARD_TRADE_SIZE_UNITS = 1_000n;
const NORMALIZATION_ROUTE_SCHEMA = z.array(
  z.object({ poolAddress: z.string().transform((value) => getAddress(value)) }).passthrough(),
);

type SourceAvailability = {
  status: RiskDataSource['status'];
  reason: string | null;
  provider: string;
  fetchedAt: string | null;
};

export type LiquidityContextSourceResult = SourceAvailability & {
  input: LiquidityRiskInput | null;
};

export interface LiquidityContextSource {
  load(input: {
    target: RiskScanJobInput['target'];
    sourceBlock: bigint;
    sourceBlockHash: Hash;
    methodologyVersion: string;
  }): Promise<LiquidityContextSourceResult>;
}

export interface LiquidityPoolStateReader {
  readPoolState(pool: NormalizedPool, blockNumber: bigint): Promise<NormalizedPoolState | null>;
}

export class LiquidityProjectionPendingError extends Error {
  constructor() {
    super('LIQUIDITY_LP_TRANSFER_PROJECTION_PENDING');
    this.name = 'LiquidityProjectionPendingError';
  }
}

type IndexedTransfer = {
  blockNumber: bigint;
  blockHash: Hash;
  transactionHash: Hash;
  logIndex: number;
  fromAddress: Address;
  toAddress: Address;
  amountRaw: bigint;
};

type OwnershipSnapshot = {
  providers: LiquidityRiskInput['providers'];
  burnedProviders: LiquidityRiskInput['burnedProviders'];
  burnedLiquidityRaw: bigint;
  additionsRaw: bigint;
  removalsRaw: bigint;
  removalEvents: LiquidityRiskInput['removalEvents'];
  balances: ReadonlyMap<string, bigint>;
};

type NormalizationAsset = {
  address: Address;
  decimals: number;
};

type LoadedPool = {
  pool: NormalizedPool;
  state: Extract<NormalizedPoolState, { poolType: 'constantProduct' }>;
  tracked: { address: Address; tokenIs0: boolean };
  ownership: OwnershipSnapshot;
  resolvedOwnership: LiquidityOwnership;
  creator: LiquidityRiskInput['providers'][number] | undefined;
  normalization: LiquidityPoolEvidence['normalization'] | null;
  standardTradeImpacts: readonly StandardTradeImpact[];
};

type LiquidityLoadInput = {
  target: RiskScanJobInput['target'];
  sourceBlock: bigint;
  sourceBlockHash: Hash;
  methodologyVersion: string;
};

type PoolLoadResult = { loaded: LoadedPool; reason: null } | { loaded: null; reason: string };

type NormalizationRow = {
  observationKey: string;
  sourceKey: string;
  priceRaw: string | null;
  priceDecimals: number;
  sourceBlock: bigint | null;
  sourceBlockHash: string | null;
  sourceTimestamp: Date;
  observedAt: Date;
  poolAddress: string | null;
  route: unknown;
  maximumStalenessSeconds: number;
  verificationSourceUrl: string;
  verifiedAt: Date;
};

function unavailable(
  reason: string,
  provider = 'hood_sentry_liquidity_index',
): LiquidityContextSourceResult {
  return { status: 'unavailable', reason, provider, fetchedAt: null, input: null };
}

function transferKey(value: {
  blockHash: string;
  transactionHash: string;
  logIndex: number;
}): string {
  return `${value.blockHash.toLowerCase()}:${value.transactionHash.toLowerCase()}:${value.logIndex}`;
}

function hash(value: string): Hash {
  if (!isHash(value)) throw new Error(`Invalid indexed hash: ${value}`);
  return value;
}

function addressFromTopic(value: string | null): Address | null {
  if (value === null || !WORD.test(value)) return null;
  return getAddress(`0x${value.slice(-40)}`);
}

function dexAdapter(manager: ProtocolAdapterManager, pool: NormalizedPool): DexAdapter | null {
  const adapter = manager
    .getActiveAdapters()
    .find(
      (candidate) =>
        candidate.chainId === pool.chainId &&
        candidate.protocolKey === pool.protocolKey &&
        candidate.version === pool.protocolVersion,
    );
  return adapter !== undefined && isDexAdapter(adapter) ? adapter : null;
}

function isDexAdapter(adapter: ProtocolAdapter): adapter is DexAdapter {
  return adapter.kind === 'dex' && 'readPoolState' in adapter;
}

export class VerifiedProtocolPoolStateReader implements LiquidityPoolStateReader {
  constructor(private readonly manager: ProtocolAdapterManager) {}

  async readPoolState(
    pool: NormalizedPool,
    blockNumber: bigint,
  ): Promise<NormalizedPoolState | null> {
    const adapter = dexAdapter(this.manager, pool);
    if (adapter === null) return null;
    const validation = await adapter.validateConfiguration();
    if (!validation.active) return null;
    this.manager.registerPool(pool);
    return adapter.readPoolState(pool.poolAddress, blockNumber);
  }
}

function addBalance(balances: Map<string, bigint>, address: Address, delta: bigint): void {
  const key = address.toLowerCase();
  balances.set(key, (balances.get(key) ?? 0n) + delta);
}

function aggregateTransfers(
  transfers: readonly IndexedTransfer[],
  sourceBlock: bigint,
): {
  balances: Map<string, bigint>;
  zeroLockedRaw: bigint;
  additionsRaw: bigint;
  removalsRaw: bigint;
  removalEvents: LiquidityRiskInput['removalEvents'];
} {
  const balances = new Map<string, bigint>();
  let zeroLockedRaw = 0n;
  let additionsRaw = 0n;
  let removalsRaw = 0n;
  const removalEvents: LiquidityRiskInput['removalEvents'][number][] = [];
  for (const transfer of transfers) {
    const fromZero = transfer.fromAddress.toLowerCase() === ZERO_ADDRESS;
    const toZero = transfer.toAddress.toLowerCase() === ZERO_ADDRESS;
    if (fromZero && toZero) {
      zeroLockedRaw += transfer.amountRaw;
    } else {
      if (!fromZero) addBalance(balances, transfer.fromAddress, -transfer.amountRaw);
      if (!toZero) addBalance(balances, transfer.toAddress, transfer.amountRaw);
    }
    if (transfer.blockNumber !== sourceBlock) continue;
    if (fromZero) additionsRaw += transfer.amountRaw;
    if (toZero && !fromZero) {
      removalsRaw += transfer.amountRaw;
      removalEvents.push({
        amountRaw: transfer.amountRaw,
        blockNumber: transfer.blockNumber,
        blockHash: transfer.blockHash,
        transactionHash: transfer.transactionHash,
        logIndex: transfer.logIndex,
      });
    }
  }
  return { balances, zeroLockedRaw, additionsRaw, removalsRaw, removalEvents };
}

function burnedProviderEvidence(
  zeroLockedRaw: bigint,
  deadBalance: bigint,
): LiquidityRiskInput['burnedProviders'] {
  const values: LiquidityRiskInput['burnedProviders'][number][] = [];
  if (zeroLockedRaw > 0n) {
    values.push({ address: getAddress(ZERO_ADDRESS), liquidityRaw: zeroLockedRaw });
  }
  if (deadBalance > 0n) {
    values.push({ address: getAddress(DEAD_ADDRESS), liquidityRaw: deadBalance });
  }
  return values;
}

function compareProviders(
  left: LiquidityRiskInput['providers'][number],
  right: LiquidityRiskInput['providers'][number],
): number {
  if (left.liquidityRaw === right.liquidityRaw) return left.address.localeCompare(right.address);
  return left.liquidityRaw > right.liquidityRaw ? -1 : 1;
}

function comparePoolDepth(left: LiquidityPoolEvidence, right: LiquidityPoolEvidence): number {
  if (left.normalizedQuoteLiquidityRaw === right.normalizedQuoteLiquidityRaw) {
    return left.poolAddress.localeCompare(right.poolAddress);
  }
  return left.normalizedQuoteLiquidityRaw > right.normalizedQuoteLiquidityRaw ? -1 : 1;
}

function compareTradeImpact(left: StandardTradeImpact, right: StandardTradeImpact): number {
  if (left.expectedTokenOutRaw !== right.expectedTokenOutRaw) {
    return left.expectedTokenOutRaw > right.expectedTokenOutRaw ? -1 : 1;
  }
  if (left.priceImpactBps !== right.priceImpactBps) {
    return left.priceImpactBps < right.priceImpactBps ? -1 : 1;
  }
  return left.poolAddress.localeCompare(right.poolAddress);
}

function normalizedLpAmount(
  normalizedQuoteLiquidityRaw: bigint,
  lpAmountRaw: bigint,
  lpTotalSupplyRaw: bigint,
): bigint {
  if (lpTotalSupplyRaw <= 0n) return 0n;
  return (normalizedQuoteLiquidityRaw * lpAmountRaw) / lpTotalSupplyRaw;
}

function aggregateNormalizedProviders(
  pools: readonly LiquidityPoolEvidence[],
  select: (pool: LiquidityPoolEvidence) => LiquidityPoolEvidence['providers'],
): LiquidityRiskInput['providers'] {
  const balances = new Map<string, bigint>();
  for (const pool of pools) {
    for (const provider of select(pool)) {
      const amount = normalizedLpAmount(
        pool.normalizedQuoteLiquidityRaw,
        provider.liquidityRaw,
        pool.currentLiquidityRaw,
      );
      if (amount <= 0n) continue;
      const key = provider.address.toLowerCase();
      balances.set(key, (balances.get(key) ?? 0n) + amount);
    }
  }
  return [...balances.entries()]
    .map(([address, liquidityRaw]) => ({ address: getAddress(address), liquidityRaw }))
    .sort(compareProviders);
}

function aggregateNormalizedLpAmounts(
  pools: readonly LiquidityPoolEvidence[],
  select: (pool: LiquidityPoolEvidence) => bigint,
): bigint {
  return pools.reduce(
    (total, pool) =>
      total +
      normalizedLpAmount(pool.normalizedQuoteLiquidityRaw, select(pool), pool.currentLiquidityRaw),
    0n,
  );
}

function aggregateOwnership(pools: readonly LiquidityPoolEvidence[]): LiquidityOwnership {
  const creatorControlled = pools
    .filter((pool) => pool.ownership.kind === 'creator')
    .sort(comparePoolDepth)[0];
  if (creatorControlled !== undefined) return creatorControlled.ownership;
  if (pools.some((pool) => !pool.ownership.verified || pool.ownership.kind === 'unknown')) {
    return { kind: 'unknown', verified: false };
  }
  if (pools.every((pool) => pool.ownership.kind === 'burned')) {
    return { kind: 'burned', verified: true };
  }
  const locked = pools.filter((pool) => pool.ownership.kind === 'locked').sort(comparePoolDepth)[0];
  return locked?.ownership ?? { kind: 'unknown', verified: false };
}

function ownershipSnapshot(
  transfers: readonly IndexedTransfer[],
  totalSupplyRaw: bigint,
  sourceBlock: bigint,
): OwnershipSnapshot | null {
  const aggregate = aggregateTransfers(transfers, sourceBlock);
  const { balances, zeroLockedRaw } = aggregate;
  if ([...balances.values()].some((balance) => balance < 0n)) return null;
  const positiveBalances = [...balances.entries()].filter(([, balance]) => balance > 0n);
  const accountedSupply = positiveBalances.reduce(
    (total, [, balance]) => total + balance,
    zeroLockedRaw,
  );
  if (accountedSupply !== totalSupplyRaw) return null;

  const deadKey = DEAD_ADDRESS.toLowerCase();
  const deadBalance = balances.get(deadKey) ?? 0n;
  const burnedProviders = burnedProviderEvidence(zeroLockedRaw, deadBalance);
  const providers = positiveBalances
    .filter(([address]) => address !== deadKey)
    .map(([address, liquidityRaw]) => ({ address: getAddress(address), liquidityRaw }))
    .sort(compareProviders);

  return {
    providers,
    burnedProviders,
    burnedLiquidityRaw: zeroLockedRaw + deadBalance,
    additionsRaw: aggregate.additionsRaw,
    removalsRaw: aggregate.removalsRaw,
    removalEvents: aggregate.removalEvents,
    balances,
  };
}

function creatorPosition(
  ownership: OwnershipSnapshot,
  creators: ReadonlySet<string>,
): LiquidityRiskInput['providers'][number] | undefined {
  return ownership.providers
    .filter((provider) => creators.has(provider.address.toLowerCase()))
    .sort(compareProviders)[0];
}

function lpOwnership(
  ownership: OwnershipSnapshot,
  totalSupplyRaw: bigint,
  creator: LiquidityRiskInput['providers'][number] | undefined,
  lock: LiquidityRiskInput['ownership'] | null,
): LiquidityRiskInput['ownership'] {
  if (creator !== undefined) return { kind: 'creator', owner: creator.address, verified: true };
  if (ownership.burnedLiquidityRaw === totalSupplyRaw && totalSupplyRaw > 0n) {
    return { kind: 'burned', verified: true };
  }
  return lock ?? { kind: 'unknown', verified: false };
}

function trackedPoolToken(
  pool: NormalizedPool,
  target: RiskScanJobInput['target'],
): { address: Address; tokenIs0: boolean } | null {
  const address = target.type === 'pool' ? pool.token0Address : getAddress(target.address);
  const tokenIs0 = address.toLowerCase() === pool.token0Address.toLowerCase();
  const tokenIs1 = address.toLowerCase() === pool.token1Address.toLowerCase();
  return tokenIs0 || tokenIs1 ? { address, tokenIs0 } : null;
}

export class DrizzleLiquidityContextSource implements LiquidityContextSource {
  constructor(
    private readonly database: Database,
    private readonly poolStateReader: LiquidityPoolStateReader,
    private readonly repository: Pick<
      ProtocolRepository,
      'getPool' | 'getPoolsByToken' | 'getMigration' | 'updatePoolState'
    >,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async load(input: LiquidityLoadInput): Promise<LiquidityContextSourceResult> {
    const poolResult = await this.resolvePools(input.target, input.sourceBlock);
    if (poolResult.pools.length === 0) return unavailable(poolResult.reason);
    const firstPool = poolResult.pools[0];
    if (firstPool === undefined) return unavailable('LIQUIDITY_POOL_NOT_INDEXED');
    const blockTimestamp = await this.blockTimestamp(
      firstPool.chainId,
      input.sourceBlock,
      input.sourceBlockHash,
    );
    const normalizationAsset = this.normalizationAsset(firstPool.chainId);
    const excludedPools = new Set(poolResult.pools.map((pool) => pool.poolAddress.toLowerCase()));
    const loadedPools: LoadedPool[] = [];
    for (const pool of poolResult.pools) {
      const result = await this.loadPinnedPool(
        pool,
        input,
        blockTimestamp,
        normalizationAsset,
        excludedPools,
      );
      if (result.loaded === null) return unavailable(result.reason);
      loadedPools.push(result.loaded);
    }

    if (loadedPools.some((pool) => pool.normalization === null)) {
      if (loadedPools.length > 1) {
        return unavailable('LIQUIDITY_QUOTE_NORMALIZATION_UNAVAILABLE');
      }
      const only = loadedPools[0];
      if (only === undefined) return unavailable('LIQUIDITY_POOL_NOT_INDEXED');
      return this.singlePoolResult(only, input);
    }
    if (normalizationAsset === null) {
      return unavailable('LIQUIDITY_NORMALIZATION_ASSET_UNAVAILABLE');
    }
    return this.normalizedResult(loadedPools, normalizationAsset, input);
  }

  private async loadPinnedPool(
    pool: NormalizedPool,
    input: LiquidityLoadInput,
    blockTimestamp: Date,
    normalizationAsset: NormalizationAsset | null,
    excludedPools: ReadonlySet<string>,
  ): Promise<PoolLoadResult> {
    const state = await this.poolStateReader.readPoolState(pool, input.sourceBlock);
    if (state === null) return { loaded: null, reason: 'LIQUIDITY_PROTOCOL_NOT_VERIFIED' };
    if (state.poolType !== 'constantProduct') {
      return { loaded: null, reason: 'LIQUIDITY_OWNERSHIP_MODEL_UNSUPPORTED' };
    }
    await this.repository.updatePoolState(
      pool.chainId,
      pool.poolAddress,
      state,
      input.sourceBlock,
      input.sourceBlockHash,
    );
    const transfers = await this.loadSynchronizedTransfers(pool, input.sourceBlock);
    const ownership = ownershipSnapshot(transfers, state.lpTotalSupplyRaw, input.sourceBlock);
    if (ownership === null) return { loaded: null, reason: 'LIQUIDITY_LP_SUPPLY_MISMATCH' };
    const tracked = trackedPoolToken(pool, input.target);
    if (tracked === null) return { loaded: null, reason: 'LIQUIDITY_TARGET_NOT_IN_POOL' };
    const creators = await this.creatorAddresses(pool, input.target, input.sourceBlock);
    const lock = await this.verifiedLock(
      pool,
      input.sourceBlock,
      blockTimestamp,
      input.methodologyVersion,
      ownership,
      state.lpTotalSupplyRaw,
    );
    const creator = creatorPosition(ownership, creators);
    const resolvedOwnership = lpOwnership(ownership, state.lpTotalSupplyRaw, creator, lock);
    const quoteAsset = tracked.tokenIs0 ? pool.token1Address : pool.token0Address;
    const normalization =
      normalizationAsset === null
        ? null
        : await this.quoteNormalization(
            pool.chainId,
            quoteAsset,
            normalizationAsset,
            input.sourceBlock,
            blockTimestamp,
            excludedPools,
          );
    return {
      reason: null,
      loaded: {
        pool,
        state,
        tracked,
        ownership,
        resolvedOwnership,
        creator,
        normalization,
        standardTradeImpacts:
          normalization === null
            ? []
            : this.poolTradeImpacts(pool, state, tracked.tokenIs0, normalization),
      },
    };
  }

  private async normalizedResult(
    loadedPools: readonly LoadedPool[],
    normalizationAsset: NormalizationAsset,
    input: LiquidityLoadInput,
  ): Promise<LiquidityContextSourceResult> {
    const poolEvidence = loadedPools.map((loaded) => this.poolEvidence(loaded, input.sourceBlock));
    const normalizedQuoteLiquidityRaw = poolEvidence.reduce(
      (total, pool) => total + pool.normalizedQuoteLiquidityRaw,
      0n,
    );
    if (normalizedQuoteLiquidityRaw <= 0n) {
      return unavailable('LIQUIDITY_NORMALIZED_DEPTH_ZERO');
    }
    const primaryEvidence = [...poolEvidence].sort(comparePoolDepth)[0];
    if (primaryEvidence === undefined) return unavailable('LIQUIDITY_POOL_NOT_INDEXED');
    const primary = loadedPools.find(
      (loaded) =>
        loaded.pool.poolAddress.toLowerCase() === primaryEvidence.poolAddress.toLowerCase(),
    );
    if (primary === undefined) throw new Error('LIQUIDITY_PRIMARY_POOL_MISSING');

    const standardTradeImpacts = this.bestTradeImpacts(poolEvidence, normalizationAsset);
    const primaryTradeAmount =
      PRIMARY_STANDARD_TRADE_SIZE_UNITS * pow10(normalizationAsset.decimals);
    const primaryTradeImpact = standardTradeImpacts.find(
      (impact) => impact.amountQuoteRaw === primaryTradeAmount,
    );
    const providers = aggregateNormalizedProviders(poolEvidence, (pool) => pool.providers);
    const burnedProviders = aggregateNormalizedProviders(
      poolEvidence,
      (pool) => pool.burnedProviders,
    );
    const burnedLiquidityRaw = burnedProviders.reduce(
      (total, provider) => total + provider.liquidityRaw,
      0n,
    );
    const resolvedOwnership = aggregateOwnership(poolEvidence);
    const migration =
      input.target.type === 'pool'
        ? null
        : await this.repository.getMigration(
            primary.pool.chainId,
            primary.tracked.address,
            input.sourceBlock,
          );
    const providerKeys = [...new Set(loadedPools.map((loaded) => loaded.pool.protocolKey))].sort();

    return {
      status: 'available',
      reason: null,
      provider: `${providerKeys.join('+')}:normalized-liquidity:rpc`,
      fetchedAt: this.now().toISOString(),
      input: {
        chainId: primary.pool.chainId,
        poolAddress: primary.pool.poolAddress,
        protocolKey: primary.pool.protocolKey,
        poolType: primary.pool.poolType,
        quoteAsset: normalizationAsset.address,
        verifiedProtocol: true,
        sourceBlock: input.sourceBlock,
        sourceBlockHash: input.sourceBlockHash,
        poolAgeBlocks: input.sourceBlock - primary.pool.createdBlockNumber,
        tokenLiquidityRaw: primaryEvidence.tokenLiquidityRaw,
        quoteLiquidityRaw: primaryEvidence.quoteLiquidityRaw,
        currentLiquidityRaw: normalizedQuoteLiquidityRaw,
        burnedLiquidityRaw,
        burnedProviders,
        feeTier: primary.pool.feeTier,
        priceImpactBps: primaryTradeImpact?.priceImpactBps,
        providers,
        ownership: resolvedOwnership,
        removalsRaw: aggregateNormalizedLpAmounts(poolEvidence, (pool) => pool.removalsRaw),
        additionsRaw: aggregateNormalizedLpAmounts(poolEvidence, (pool) => pool.additionsRaw),
        removalEvents: poolEvidence.flatMap((pool) => pool.removalEvents),
        creatorAddress: resolvedOwnership.kind === 'creator' ? resolvedOwnership.owner : undefined,
        migrationDestination: migration?.destinationPoolAddress,
        normalizationQuoteAsset: normalizationAsset.address,
        normalizationQuoteDecimals: normalizationAsset.decimals,
        normalizedQuoteLiquidityRaw,
        standardTradeSizeQuoteRaw: primaryTradeAmount,
        standardTradeImpacts,
        poolCount: poolEvidence.length,
        poolConcentrationBps:
          (primaryEvidence.normalizedQuoteLiquidityRaw * 10_000n) / normalizedQuoteLiquidityRaw,
        pools: poolEvidence,
      },
    };
  }

  private async resolvePools(
    target: RiskScanJobInput['target'],
    sourceBlock: bigint,
  ): Promise<{ pools: readonly NormalizedPool[]; reason: string }> {
    if (target.type === 'pool') {
      const pool = await this.repository.getPool(target.chainId, target.address, sourceBlock);
      return { pools: pool === null ? [] : [pool], reason: 'LIQUIDITY_POOL_NOT_INDEXED' };
    }
    const pools = await this.repository.getPoolsByToken(
      target.chainId,
      target.address,
      sourceBlock,
    );
    return {
      pools: [...pools].sort((left, right) => left.poolAddress.localeCompare(right.poolAddress)),
      reason: 'LIQUIDITY_POOL_NOT_INDEXED',
    };
  }

  private normalizationAsset(chainId: number): NormalizationAsset | null {
    const assets = canonicalAssetRegistry.entries.filter(
      (entry) => entry.chainId === chainId && entry.enabled && entry.category === 'stablecoin',
    );
    const asset = assets.length === 1 ? assets[0] : undefined;
    return asset === undefined ? null : { address: asset.address, decimals: asset.decimals };
  }

  private async assetDecimals(chainId: number, address: Address): Promise<number | null> {
    const canonical = canonicalAssetRegistry.entries.find(
      (entry) =>
        entry.chainId === chainId &&
        entry.enabled &&
        entry.address.toLowerCase() === address.toLowerCase(),
    );
    if (canonical !== undefined) return canonical.decimals;
    const rows = await this.database.db
      .select({ decimals: schema.tokens.decimals })
      .from(schema.tokens)
      .where(
        and(eq(schema.tokens.chain_id, chainId), eq(schema.tokens.address, address.toLowerCase())),
      )
      .limit(1);
    const decimals = rows[0]?.decimals ?? null;
    if (decimals !== null) pow10(decimals);
    return decimals;
  }

  private async quoteNormalization(
    chainId: number,
    quoteAsset: Address,
    normalizationAsset: NormalizationAsset,
    sourceBlock: bigint,
    blockTimestamp: Date,
    excludedPools: ReadonlySet<string>,
  ): Promise<LiquidityPoolEvidence['normalization'] | null> {
    const quoteDecimals = await this.assetDecimals(chainId, quoteAsset);
    if (quoteDecimals === null) return null;
    if (quoteAsset.toLowerCase() === normalizationAsset.address.toLowerCase()) {
      return {
        kind: 'identity',
        quoteDecimals,
        normalizationQuoteAsset: normalizationAsset.address,
        normalizationQuoteDecimals: normalizationAsset.decimals,
        priceRaw: 1n,
        priceDecimals: 0,
      };
    }

    const rows = await this.database.db
      .select({
        observationKey: schema.deterministicPriceObservations.observation_key,
        sourceKey: schema.deterministicPriceObservations.source_key,
        priceRaw: schema.deterministicPriceObservations.price_raw,
        priceDecimals: schema.deterministicPriceObservations.price_decimals,
        sourceBlock: schema.deterministicPriceObservations.source_block_number,
        sourceBlockHash: schema.deterministicPriceObservations.source_block_hash,
        sourceTimestamp: schema.deterministicPriceObservations.source_timestamp,
        observedAt: schema.deterministicPriceObservations.observed_at,
        poolAddress: schema.deterministicPriceObservations.pool_address,
        route: schema.deterministicPriceObservations.route,
        maximumStalenessSeconds: schema.priceSourceConfigs.maximum_staleness_seconds,
        verificationSourceUrl: schema.priceSourceConfigs.verification_source_url,
        verifiedAt: schema.priceSourceConfigs.verified_at,
      })
      .from(schema.deterministicPriceObservations)
      .innerJoin(
        schema.priceSourceConfigs,
        eq(schema.priceSourceConfigs.source_key, schema.deterministicPriceObservations.source_key),
      )
      .where(
        and(
          eq(schema.deterministicPriceObservations.chain_id, chainId),
          eq(schema.deterministicPriceObservations.token_address, quoteAsset.toLowerCase()),
          eq(
            schema.deterministicPriceObservations.quote_asset_address,
            normalizationAsset.address.toLowerCase(),
          ),
          eq(schema.deterministicPriceObservations.status, 'available'),
          eq(schema.deterministicPriceObservations.authoritative, true),
          eq(schema.deterministicPriceObservations.stale, false),
          eq(schema.deterministicPriceObservations.canonical, true),
          eq(schema.priceSourceConfigs.enabled, true),
          isNotNull(schema.deterministicPriceObservations.price_raw),
          isNotNull(schema.deterministicPriceObservations.source_block_number),
          isNotNull(schema.deterministicPriceObservations.source_block_hash),
          lte(schema.deterministicPriceObservations.source_block_number, sourceBlock),
          lte(schema.deterministicPriceObservations.source_timestamp, blockTimestamp),
          lte(schema.deterministicPriceObservations.observed_at, blockTimestamp),
        ),
      )
      .orderBy(
        desc(schema.deterministicPriceObservations.source_block_number),
        desc(schema.deterministicPriceObservations.observed_at),
      );

    for (const row of rows) {
      const normalization = await this.normalizationFromRow(
        row,
        chainId,
        quoteDecimals,
        normalizationAsset,
        blockTimestamp,
        excludedPools,
      );
      if (normalization !== null) return normalization;
    }
    return null;
  }

  private async normalizationFromRow(
    row: NormalizationRow,
    chainId: number,
    quoteDecimals: number,
    normalizationAsset: NormalizationAsset,
    blockTimestamp: Date,
    excludedPools: ReadonlySet<string>,
  ): Promise<LiquidityPoolEvidence['normalization'] | null> {
    if (row.priceRaw === null || row.sourceBlock === null || row.sourceBlockHash === null)
      return null;
    const priceRaw = BigInt(row.priceRaw);
    if (priceRaw <= 0n) return null;
    const ageMilliseconds = blockTimestamp.getTime() - row.sourceTimestamp.getTime();
    if (ageMilliseconds < 0 || ageMilliseconds > row.maximumStalenessSeconds * 1_000) return null;
    if (row.poolAddress !== null && excludedPools.has(row.poolAddress.toLowerCase())) return null;
    const route = NORMALIZATION_ROUTE_SCHEMA.safeParse(row.route);
    if (
      !route.success ||
      route.data.some((step) => excludedPools.has(step.poolAddress.toLowerCase()))
    ) {
      return null;
    }
    const sourceHash = hash(row.sourceBlockHash);
    const canonicalBlock = await this.database.db
      .select({ number: schema.blocks.number })
      .from(schema.blocks)
      .where(
        and(
          eq(schema.blocks.chainId, BigInt(chainId)),
          eq(schema.blocks.number, row.sourceBlock),
          eq(schema.blocks.hash, sourceHash),
          eq(schema.blocks.canonical, true),
        ),
      )
      .limit(1);
    if (canonicalBlock.length === 0) return null;
    return {
      kind: 'price_observation',
      quoteDecimals,
      normalizationQuoteAsset: normalizationAsset.address,
      normalizationQuoteDecimals: normalizationAsset.decimals,
      priceRaw,
      priceDecimals: row.priceDecimals,
      observationKey: row.observationKey,
      sourceKey: row.sourceKey,
      sourceBlock: row.sourceBlock,
      sourceBlockHash: sourceHash,
      sourceTimestamp: row.sourceTimestamp.toISOString(),
      observedAt: row.observedAt.toISOString(),
      maximumStalenessSeconds: row.maximumStalenessSeconds,
      verificationSourceUrl: row.verificationSourceUrl,
      verifiedAt: row.verifiedAt.toISOString(),
    };
  }

  private poolTradeImpacts(
    pool: NormalizedPool,
    state: Extract<NormalizedPoolState, { poolType: 'constantProduct' }>,
    tokenIs0: boolean,
    normalization: LiquidityPoolEvidence['normalization'],
  ): readonly StandardTradeImpact[] {
    const reserveInRaw = tokenIs0 ? state.reserve1Raw : state.reserve0Raw;
    const reserveOutRaw = tokenIs0 ? state.reserve0Raw : state.reserve1Raw;
    if (
      pool.feeTier === undefined ||
      pool.feeTier < 0n ||
      pool.feeTier >= FEE_DENOMINATOR ||
      reserveInRaw <= 0n ||
      reserveOutRaw <= 0n
    ) {
      return [];
    }
    const rate = {
      sourceDecimals: normalization.quoteDecimals,
      normalizedDecimals: normalization.normalizationQuoteDecimals,
      priceRaw: normalization.priceRaw,
      priceDecimals: normalization.priceDecimals,
    };
    const results: StandardTradeImpact[] = [];
    for (const units of STANDARD_TRADE_SIZE_UNITS) {
      const amountQuoteRaw = units * pow10(normalization.normalizationQuoteDecimals);
      const amountPoolQuoteRaw = denormalizeQuoteAmount(amountQuoteRaw, rate);
      if (amountPoolQuoteRaw <= 0n) continue;
      const amountInAfterFee = amountPoolQuoteRaw * (FEE_DENOMINATOR - pool.feeTier);
      const numerator = amountInAfterFee * reserveOutRaw;
      const denominator = reserveInRaw * FEE_DENOMINATOR + amountInAfterFee;
      if (numerator < denominator) continue;
      const quote = quoteConstantProductSwap({
        amountInRaw: amountPoolQuoteRaw,
        reserveInRaw,
        reserveOutRaw,
        feeRaw: pool.feeTier,
        feeDenominator: FEE_DENOMINATOR,
      });
      results.push({
        amountQuoteRaw,
        amountPoolQuoteRaw,
        expectedTokenOutRaw: quote.amountOutRaw,
        priceImpactBps: quote.priceImpactBps,
        poolAddress: pool.poolAddress,
      });
    }
    return results;
  }

  private poolEvidence(loaded: LoadedPool, sourceBlock: bigint): LiquidityPoolEvidence {
    const normalization = loaded.normalization;
    if (normalization === null) throw new Error('LIQUIDITY_POOL_NORMALIZATION_MISSING');
    const tokenLiquidityRaw = loaded.tracked.tokenIs0
      ? loaded.state.reserve0Raw
      : loaded.state.reserve1Raw;
    const quoteLiquidityRaw = loaded.tracked.tokenIs0
      ? loaded.state.reserve1Raw
      : loaded.state.reserve0Raw;
    const normalizedQuoteLiquidityRaw = normalizeQuoteAmount(quoteLiquidityRaw, {
      sourceDecimals: normalization.quoteDecimals,
      normalizedDecimals: normalization.normalizationQuoteDecimals,
      priceRaw: normalization.priceRaw,
      priceDecimals: normalization.priceDecimals,
    });
    return {
      poolAddress: loaded.pool.poolAddress,
      protocolKey: loaded.pool.protocolKey,
      protocolVersion: loaded.pool.protocolVersion,
      poolType: loaded.pool.poolType,
      quoteAsset: loaded.tracked.tokenIs0 ? loaded.pool.token1Address : loaded.pool.token0Address,
      poolAgeBlocks: sourceBlock - loaded.pool.createdBlockNumber,
      tokenLiquidityRaw,
      quoteLiquidityRaw,
      currentLiquidityRaw: loaded.state.lpTotalSupplyRaw,
      burnedLiquidityRaw: loaded.ownership.burnedLiquidityRaw,
      burnedProviders: loaded.ownership.burnedProviders,
      providers: loaded.ownership.providers,
      ownership: loaded.resolvedOwnership,
      removalsRaw: loaded.ownership.removalsRaw,
      additionsRaw: loaded.ownership.additionsRaw,
      removalEvents: loaded.ownership.removalEvents,
      normalizedQuoteLiquidityRaw,
      normalization,
      standardTradeImpacts: loaded.standardTradeImpacts,
    };
  }

  private bestTradeImpacts(
    pools: readonly LiquidityPoolEvidence[],
    normalizationAsset: NormalizationAsset,
  ): readonly StandardTradeImpact[] {
    return STANDARD_TRADE_SIZE_UNITS.flatMap((units) => {
      const amountQuoteRaw = units * pow10(normalizationAsset.decimals);
      const best = pools
        .flatMap((pool) => pool.standardTradeImpacts)
        .filter((impact) => impact.amountQuoteRaw === amountQuoteRaw)
        .sort(compareTradeImpact)[0];
      return best === undefined ? [] : [best];
    });
  }

  private async singlePoolResult(
    loaded: LoadedPool,
    input: {
      target: RiskScanJobInput['target'];
      sourceBlock: bigint;
      sourceBlockHash: Hash;
      methodologyVersion: string;
    },
  ): Promise<LiquidityContextSourceResult> {
    const migration =
      input.target.type === 'pool'
        ? null
        : await this.repository.getMigration(
            loaded.pool.chainId,
            loaded.tracked.address,
            input.sourceBlock,
          );
    return {
      status: 'available',
      reason: null,
      provider: `${loaded.pool.protocolKey}:${loaded.pool.protocolVersion}:rpc`,
      fetchedAt: this.now().toISOString(),
      input: {
        chainId: loaded.pool.chainId,
        poolAddress: loaded.pool.poolAddress,
        protocolKey: loaded.pool.protocolKey,
        poolType: loaded.pool.poolType,
        quoteAsset: loaded.tracked.tokenIs0 ? loaded.pool.token1Address : loaded.pool.token0Address,
        verifiedProtocol: true,
        sourceBlock: input.sourceBlock,
        sourceBlockHash: input.sourceBlockHash,
        poolAgeBlocks: input.sourceBlock - loaded.pool.createdBlockNumber,
        tokenLiquidityRaw: loaded.tracked.tokenIs0
          ? loaded.state.reserve0Raw
          : loaded.state.reserve1Raw,
        quoteLiquidityRaw: loaded.tracked.tokenIs0
          ? loaded.state.reserve1Raw
          : loaded.state.reserve0Raw,
        currentLiquidityRaw: loaded.state.lpTotalSupplyRaw,
        burnedLiquidityRaw: loaded.ownership.burnedLiquidityRaw,
        burnedProviders: loaded.ownership.burnedProviders,
        feeTier: loaded.pool.feeTier,
        providers: loaded.ownership.providers,
        ownership: loaded.resolvedOwnership,
        removalsRaw: loaded.ownership.removalsRaw,
        additionsRaw: loaded.ownership.additionsRaw,
        removalEvents: loaded.ownership.removalEvents,
        creatorAddress: loaded.creator?.address,
        migrationDestination: migration?.destinationPoolAddress,
        poolCount: 1,
      },
    };
  }

  private async blockTimestamp(
    chainId: number,
    blockNumber: bigint,
    blockHash: Hash,
  ): Promise<Date> {
    const rows = await this.database.db
      .select({ timestamp: schema.blocks.timestamp })
      .from(schema.blocks)
      .where(
        and(
          eq(schema.blocks.chainId, BigInt(chainId)),
          eq(schema.blocks.number, blockNumber),
          eq(schema.blocks.hash, blockHash),
          eq(schema.blocks.canonical, true),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (row === undefined) throw new Error('LIQUIDITY_SOURCE_BLOCK_NOT_CANONICAL');
    return row.timestamp;
  }

  private async loadSynchronizedTransfers(
    pool: NormalizedPool,
    sourceBlock: bigint,
  ): Promise<readonly IndexedTransfer[]> {
    const poolAddress = pool.poolAddress.toLowerCase();
    const rawRows = await this.database.db
      .select({
        blockNumber: schema.logs.blockNumber,
        blockHash: schema.logs.blockHash,
        transactionHash: schema.logs.transactionHash,
        logIndex: schema.logs.logIndex,
        topic1: schema.logs.topic1,
        topic2: schema.logs.topic2,
        topic3: schema.logs.topic3,
        data: schema.logs.data,
      })
      .from(schema.logs)
      .where(
        and(
          eq(schema.logs.chainId, BigInt(pool.chainId)),
          sql`lower(${schema.logs.address}) = ${poolAddress}`,
          sql`lower(${schema.logs.topic0}) = ${ERC20_TRANSFER_TOPIC}`,
          lte(schema.logs.blockNumber, sourceBlock),
          eq(schema.logs.canonical, true),
        ),
      )
      .orderBy(asc(schema.logs.blockNumber), asc(schema.logs.logIndex));
    const rawTransfers = new Map<string, IndexedTransfer>();
    for (const row of rawRows) {
      if (row.topic3 !== null || !WORD.test(row.data)) continue;
      const fromAddress = addressFromTopic(row.topic1);
      const toAddress = addressFromTopic(row.topic2);
      if (fromAddress === null || toAddress === null) continue;
      const transfer: IndexedTransfer = {
        blockNumber: row.blockNumber,
        blockHash: hash(row.blockHash),
        transactionHash: hash(row.transactionHash),
        logIndex: row.logIndex,
        fromAddress,
        toAddress,
        amountRaw: BigInt(row.data),
      };
      rawTransfers.set(transferKey(transfer), transfer);
    }

    const indexedRows = await this.database.db
      .select({
        blockNumber: schema.tokenTransfers.block_number,
        blockHash: schema.tokenTransfers.block_hash,
        transactionHash: schema.tokenTransfers.transaction_hash,
        logIndex: schema.tokenTransfers.log_index,
        fromAddress: schema.tokenTransfers.from_address,
        toAddress: schema.tokenTransfers.to_address,
        amountRaw: schema.tokenTransfers.amount_raw,
      })
      .from(schema.tokenTransfers)
      .where(
        and(
          eq(schema.tokenTransfers.chain_id, pool.chainId),
          eq(schema.tokenTransfers.token_address, poolAddress),
          lte(schema.tokenTransfers.block_number, sourceBlock),
          eq(schema.tokenTransfers.canonical, true),
        ),
      )
      .orderBy(asc(schema.tokenTransfers.block_number), asc(schema.tokenTransfers.log_index));
    if (indexedRows.length !== rawTransfers.size) throw new LiquidityProjectionPendingError();

    const transfers: IndexedTransfer[] = [];
    for (const row of indexedRows) {
      const transfer: IndexedTransfer = {
        blockNumber: row.blockNumber,
        blockHash: hash(row.blockHash),
        transactionHash: hash(row.transactionHash),
        logIndex: row.logIndex,
        fromAddress: getAddress(row.fromAddress),
        toAddress: getAddress(row.toAddress),
        amountRaw: BigInt(row.amountRaw),
      };
      const raw = rawTransfers.get(transferKey(transfer));
      if (
        raw === undefined ||
        raw.fromAddress.toLowerCase() !== transfer.fromAddress.toLowerCase() ||
        raw.toAddress.toLowerCase() !== transfer.toAddress.toLowerCase() ||
        raw.amountRaw !== transfer.amountRaw
      ) {
        throw new LiquidityProjectionPendingError();
      }
      transfers.push(transfer);
    }
    return transfers;
  }

  private async creatorAddresses(
    pool: NormalizedPool,
    target: RiskScanJobInput['target'],
    sourceBlock: bigint,
  ): Promise<ReadonlySet<string>> {
    const tokenAddresses =
      target.type === 'pool'
        ? [pool.token0Address.toLowerCase(), pool.token1Address.toLowerCase()]
        : [target.address.toLowerCase()];
    const rows = await this.database.db
      .select({ creatorAddress: schema.contracts.creator_address })
      .from(schema.contracts)
      .where(
        and(
          eq(schema.contracts.chain_id, pool.chainId),
          sql`${schema.contracts.address} IN (${sql.join(
            tokenAddresses.map((address) => sql`${address}`),
            sql`, `,
          )})`,
          lte(schema.contracts.creation_block, sourceBlock),
        ),
      );
    return new Set(
      rows
        .map((row) => row.creatorAddress?.toLowerCase())
        .filter((address): address is string => address !== undefined && address !== null),
    );
  }

  private async verifiedLock(
    pool: NormalizedPool,
    sourceBlock: bigint,
    blockTimestamp: Date,
    methodologyVersion: string,
    ownership: OwnershipSnapshot,
    totalSupplyRaw: bigint,
  ): Promise<LiquidityRiskInput['ownership'] | null> {
    const rows = await this.database.db
      .select()
      .from(schema.liquidityLockEvidence)
      .where(
        and(
          eq(schema.liquidityLockEvidence.chain_id, pool.chainId),
          eq(schema.liquidityLockEvidence.pool_address, pool.poolAddress.toLowerCase()),
          eq(schema.liquidityLockEvidence.methodology_version, methodologyVersion),
          eq(schema.liquidityLockEvidence.canonical, true),
          lte(schema.liquidityLockEvidence.source_block_number, sourceBlock),
          gt(schema.liquidityLockEvidence.unlock_time, blockTimestamp),
          gt(schema.liquidityLockEvidence.verification_expires_at, this.now()),
        ),
      )
      .orderBy(desc(schema.liquidityLockEvidence.source_block_number));
    const latestByContract = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const key = row.lock_contract_address.toLowerCase();
      if (!latestByContract.has(key)) latestByContract.set(key, row);
    }
    const active = [...latestByContract.values()].filter((row) => {
      const balance = ownership.balances.get(row.lock_contract_address.toLowerCase()) ?? 0n;
      return balance >= BigInt(row.locked_amount_raw);
    });
    if (active.length !== 1) return null;
    const evidence = active[0];
    if (evidence === undefined) return null;
    const lockedRaw = BigInt(evidence.locked_amount_raw);
    if (lockedRaw + ownership.burnedLiquidityRaw < totalSupplyRaw) return null;
    return {
      kind: 'locked',
      owner: getAddress(evidence.lock_contract_address),
      lockContract: getAddress(evidence.lock_contract_address),
      beneficiary: getAddress(evidence.beneficiary_address),
      unlockTime: BigInt(Math.floor(evidence.unlock_time.getTime() / 1_000)),
      withdrawalConditions: evidence.withdrawal_conditions,
      verified: true,
      evidence: {
        sourceBlock: evidence.source_block_number,
        sourceBlockHash: hash(evidence.source_block_hash),
        transactionHash: hash(evidence.transaction_hash),
        logIndex: evidence.log_index,
        verificationSource: evidence.verification_source,
        methodologyVersion: evidence.methodology_version,
      },
    };
  }
}

function mergeSources(
  current: readonly RiskDataSource[],
  addition: RiskDataSource,
): RiskDataSource[] {
  const values = new Map(current.map((source) => [source.key, source]));
  values.set(addition.key, addition);
  return [...values.values()].sort((left, right) => left.key.localeCompare(right.key));
}

export class LiquidityRiskContextLoader implements RiskContextLoader {
  constructor(
    private readonly baseLoader: RiskContextLoader,
    private readonly source: LiquidityContextSource,
  ) {}

  async loadContext(input: RiskScanJobInput, methodologyVersion: string): Promise<RiskScanContext> {
    const context = await this.baseLoader.loadContext(input, methodologyVersion);
    if (!LIQUIDITY_TARGETS.has(context.target.type)) return context;
    if (!isHash(context.sourceBlockHash)) throw new Error('Risk context has an invalid block hash');
    const result = await this.source.load({
      target: input.target,
      sourceBlock: context.sourceBlock,
      sourceBlockHash: context.sourceBlockHash,
      methodologyVersion,
    });
    const dataSource: RiskDataSource = {
      key: LIQUIDITY_STATE_SOURCE,
      kind: 'chain',
      provider: result.provider,
      status: result.status,
      sourceBlock: context.sourceBlock,
      sourceBlockHash: context.sourceBlockHash,
      fetchedAt: result.fetchedAt,
      reason: result.reason,
    };
    return {
      ...context,
      data:
        result.input === null
          ? context.data
          : { ...context.data, liquidityAnalysis: analyzeLiquidityRisk(result.input) },
      dataSources: mergeSources(context.dataSources, dataSource),
    };
  }
}
