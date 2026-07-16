import type {
  DecodedProtocolEvent,
  DexAdapter,
  LaunchpadGraduation,
  LaunchpadMigration,
  LaunchpadTokenCreated,
  LaunchpadTrade,
  NormalizedLiquidityEvent,
  NormalizedPool,
  NormalizedPoolState,
  NormalizedQuote,
  NormalizedSwap,
  PreparedProtocolTransaction,
  PriceImpactRequest,
  PriceImpactResult,
  ProtocolEventDefinition,
  ProtocolValidationResult,
  QuoteRequest,
  RawChainLog,
} from '@hood-sentry/chain';
import { ProtocolAdapterManager } from '@hood-sentry/chain';
import type {
  ProtocolRepository,
  ProtocolSummary,
  ProtocolVerificationRecord,
} from '@hood-sentry/db';
import { type Address, getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { type DerivedJobPublisher, ProtocolEventsHandler } from './protocol-events.js';

const FACTORY = getAddress('0x1000000000000000000000000000000000000001');
const POOL = getAddress('0x2000000000000000000000000000000000000001');
const TOKEN0 = getAddress('0x3000000000000000000000000000000000000001');
const TOKEN1 = getAddress('0x3000000000000000000000000000000000000002');
const USER = getAddress('0x4000000000000000000000000000000000000001');
const BLOCK_HASH = `0x${'a'.repeat(64)}` as const;
const REPLACEMENT_HASH = `0x${'c'.repeat(64)}` as const;
const TX_HASH = `0x${'b'.repeat(64)}` as const;
const POOL_TOPIC = `0x${'1'.repeat(64)}` as const;
const SWAP_TOPIC = `0x${'2'.repeat(64)}` as const;
const LIQUIDITY_TOPIC = `0x${'3'.repeat(64)}` as const;

function raw(address: Address, topic: `0x${string}`, logIndex: number): RawChainLog {
  return {
    chainId: 4663,
    blockNumber: 100n,
    blockHash: BLOCK_HASH,
    transactionHash: TX_HASH,
    transactionIndex: 0,
    logIndex,
    address,
    topics: [topic],
    data: '0x',
    removed: false,
    canonical: true,
  };
}

class FixtureDexAdapter implements DexAdapter {
  readonly protocolKey = 'fixture';
  readonly protocolName = 'Fixture';
  readonly version = 'v1';
  readonly chainId = 4663;
  readonly kind = 'dex' as const;
  private pool: NormalizedPool | null = null;

  async validateConfiguration(): Promise<ProtocolValidationResult> {
    return {
      protocolKey: this.protocolKey,
      protocolName: this.protocolName,
      protocolVersion: this.version,
      chainId: this.chainId,
      kind: this.kind,
      active: true,
      checkedAt: '2026-07-14T00:00:00.000Z',
      expiresAt: '2026-07-14T01:00:00.000Z',
      failureCode: null,
      errors: [],
      contracts: [],
    };
  }

  getEventDefinitions(): readonly ProtocolEventDefinition[] {
    return [];
  }

  supportsAddress(address: Address): boolean {
    return (
      address.toLowerCase() === FACTORY.toLowerCase() ||
      address.toLowerCase() === this.pool?.poolAddress.toLowerCase()
    );
  }

  async decodeLog(log: RawChainLog): Promise<DecodedProtocolEvent | null> {
    const topic = log.topics[0];
    const kind =
      topic === POOL_TOPIC
        ? 'poolCreated'
        : topic === SWAP_TOPIC
          ? 'swap'
          : topic === LIQUIDITY_TOPIC
            ? 'liquidityAdded'
            : null;
    if (kind === null) return null;
    return {
      protocolKey: this.protocolKey,
      protocolName: this.protocolName,
      protocolVersion: this.version,
      kind,
      emitterAddress: log.address,
      provenance: {
        chainId: log.chainId,
        blockNumber: log.blockNumber,
        blockHash: log.blockHash,
        transactionHash: log.transactionHash,
        transactionIndex: log.transactionIndex,
        logIndex: log.logIndex,
        canonical: log.canonical,
      },
      fields: {},
    };
  }

  async discoverPool(event: DecodedProtocolEvent): Promise<NormalizedPool | null> {
    if (event.kind !== 'poolCreated') return null;
    const pool: NormalizedPool = {
      chainId: 4663,
      protocolKey: this.protocolKey,
      protocolVersion: this.version,
      poolAddress: POOL,
      factoryAddress: FACTORY,
      token0Address: TOKEN0,
      token1Address: TOKEN1,
      feeTier: 3_000n,
      poolType: 'constantProduct',
      createdBlockNumber: event.provenance.blockNumber,
      createdBlockHash: event.provenance.blockHash,
      creationTransactionHash: event.provenance.transactionHash,
      creationLogIndex: event.provenance.logIndex,
      canonical: event.provenance.canonical,
    };
    this.registerPool(pool);
    return pool;
  }

  registerPool(pool: NormalizedPool): void {
    this.pool = pool;
  }

  async readPoolState(): Promise<NormalizedPoolState> {
    return {
      poolType: 'constantProduct',
      reserve0Raw: 10n,
      reserve1Raw: 20n,
      lpTotalSupplyRaw: 5n,
    };
  }

  async decodeSwap(log: RawChainLog): Promise<NormalizedSwap | null> {
    if (log.topics[0] !== SWAP_TOPIC || this.pool === null) return null;
    return {
      chainId: 4663,
      protocolKey: this.protocolKey,
      protocolVersion: this.version,
      poolAddress: POOL,
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      logIndex: log.logIndex,
      senderAddress: USER,
      tokenInAddress: TOKEN0,
      tokenOutAddress: TOKEN1,
      amountInRaw: 100n,
      amountOutRaw: 90n,
      canonical: log.canonical,
    };
  }

  async decodeLiquidityEvent(log: RawChainLog): Promise<NormalizedLiquidityEvent | null> {
    if (log.topics[0] !== LIQUIDITY_TOPIC || this.pool === null) return null;
    return {
      chainId: 4663,
      protocolKey: this.protocolKey,
      protocolVersion: this.version,
      eventType: 'liquidityAdded',
      poolAddress: POOL,
      providerAddress: USER,
      token0Address: TOKEN0,
      token1Address: TOKEN1,
      amount0Raw: 10n,
      amount1Raw: 20n,
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      transactionHash: log.transactionHash,
      logIndex: log.logIndex,
      canonical: log.canonical,
    };
  }

  async getQuote(_request: QuoteRequest): Promise<NormalizedQuote> {
    throw new Error('unused');
  }

  async prepareSwapTransaction(
    _quote: NormalizedQuote,
    _userAddress: Address,
  ): Promise<PreparedProtocolTransaction> {
    throw new Error('unused');
  }

  calculatePriceImpact(_request: PriceImpactRequest): PriceImpactResult {
    return { priceImpactBps: 0n };
  }
}

class MemoryProtocolRepository implements ProtocolRepository {
  pools: NormalizedPool[] = [];
  swaps: NormalizedSwap[] = [];
  liquidity: NormalizedLiquidityEvent[] = [];
  migrations: LaunchpadMigration[] = [];

  async saveProtocolValidation(): Promise<void> {}
  async updatePoolState(): Promise<void> {}
  async insertLaunchpadToken(_event: LaunchpadTokenCreated): Promise<void> {}
  async insertLaunchpadTrade(_event: LaunchpadTrade): Promise<void> {}

  async insertCreatorFeeEvent(_event: LaunchpadTrade): Promise<void> {}
  async insertGraduation(_event: LaunchpadGraduation): Promise<void> {}
  async saveQuote(_quote: NormalizedQuote): Promise<void> {}
  async listProtocols(): Promise<readonly ProtocolSummary[]> {
    return [];
  }
  async listProtocolVerifications(): Promise<readonly ProtocolVerificationRecord[]> {
    return [];
  }
  async getActivePools(): Promise<readonly NormalizedPool[]> {
    return this.pools.filter((pool) => pool.canonical);
  }
  async getPool(
    _chainId: number,
    poolAddress: string,
    atBlock?: bigint,
  ): Promise<NormalizedPool | null> {
    return (
      this.pools.find(
        (pool) =>
          pool.canonical &&
          pool.poolAddress.toLowerCase() === poolAddress.toLowerCase() &&
          (atBlock === undefined || pool.createdBlockNumber <= atBlock),
      ) ?? null
    );
  }
  async getPoolsByToken(): Promise<readonly NormalizedPool[]> {
    return this.pools.filter((pool) => pool.canonical);
  }
  async getSwapsByPool(): Promise<readonly NormalizedSwap[]> {
    return this.swaps.filter((swap) => swap.canonical);
  }
  async getLiquidityHistory(): Promise<readonly NormalizedLiquidityEvent[]> {
    return this.liquidity.filter((event) => event.canonical);
  }
  async getLaunchpadToken(): Promise<LaunchpadTokenCreated | null> {
    return null;
  }
  async getGraduation(): Promise<LaunchpadGraduation | null> {
    return null;
  }
  async getMigration(): Promise<LaunchpadMigration | null> {
    return this.migrations.find((event) => event.canonical) ?? null;
  }

  async upsertPool(pool: NormalizedPool): Promise<void> {
    this.pools.push(pool);
  }

  async upsertPoolTokens(_pool: NormalizedPool): Promise<void> {}

  async insertSwap(swap: NormalizedSwap): Promise<void> {
    this.swaps.push(swap);
  }

  async insertLiquidityEvent(event: NormalizedLiquidityEvent): Promise<void> {
    this.liquidity.push(event);
  }

  async insertMigration(event: LaunchpadMigration): Promise<void> {
    const duplicate = this.migrations.some(
      (candidate) =>
        candidate.blockHash === event.blockHash &&
        candidate.transactionHash === event.transactionHash &&
        candidate.logIndex === event.logIndex,
    );
    if (!duplicate) this.migrations.push(event);
  }

  async markDerivedNonCanonical(
    _chainId: number,
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<void> {
    this.swaps = this.swaps.map((swap) =>
      swap.blockNumber >= fromBlock && swap.blockNumber <= toBlock
        ? { ...swap, canonical: false }
        : swap,
    );
    this.migrations = this.migrations.map((migration) =>
      migration.blockNumber >= fromBlock && migration.blockNumber <= toBlock
        ? { ...migration, canonical: false }
        : migration,
    );
  }
}

class MemoryPublisher implements DerivedJobPublisher {
  jobs: Array<{ type: string; key: string }> = [];

  async publish(job: { type: string }, idempotencyKey: string): Promise<void> {
    this.jobs.push({ type: job.type, key: idempotencyKey });
  }
}

function harness(active = true) {
  const adapter = new FixtureDexAdapter();
  const manager = new ProtocolAdapterManager(active ? [adapter] : []);
  const repository = new MemoryProtocolRepository();
  const publisher = new MemoryPublisher();
  const warnings: string[] = [];
  const handler = new ProtocolEventsHandler(manager, repository, publisher, {
    warn(message) {
      warnings.push(message);
    },
    error(message) {
      warnings.push(message);
    },
  });
  return { adapter, repository, publisher, warnings, handler };
}

describe('protocol event integration', () => {
  it('routes a raw pool log to a persisted normalized pool', async () => {
    const context = harness();
    await context.handler.handle(raw(FACTORY, POOL_TOPIC, 1));
    expect(context.repository.pools).toHaveLength(1);
    expect(context.repository.pools[0]).toMatchObject({ poolAddress: POOL, canonical: true });
    expect(context.publisher.jobs.map((job) => job.type)).toContain('pool-refresh');
  });

  it('routes a raw swap log to normalized storage after pool discovery', async () => {
    const context = harness();
    await context.handler.handle(raw(FACTORY, POOL_TOPIC, 1));
    await context.handler.handle(raw(POOL, SWAP_TOPIC, 2));
    expect(context.repository.swaps[0]).toMatchObject({
      amountInRaw: 100n,
      amountOutRaw: 90n,
      canonical: true,
    });
    expect(context.publisher.jobs.map((job) => job.type)).toContain('wallet-activity');
  });

  it('publishes a metric job for a liquidity event', async () => {
    const context = harness();
    await context.handler.handle(raw(FACTORY, POOL_TOPIC, 1));
    await context.handler.handle(raw(POOL, LIQUIDITY_TOPIC, 3));
    expect(context.repository.liquidity).toHaveLength(1);
    expect(context.publisher.jobs.map((job) => job.type)).toContain('liquidity-metric');
  });

  it('marks a swap noncanonical after a reorg', async () => {
    const context = harness();
    await context.handler.handle(raw(FACTORY, POOL_TOPIC, 1));
    await context.handler.handle(raw(POOL, SWAP_TOPIC, 2));
    await context.repository.markDerivedNonCanonical(4663, 100n, 100n);
    expect(context.repository.swaps[0]?.canonical).toBe(false);
  });

  it('replaces an orphaned migration with a canonical migration', async () => {
    const context = harness();
    const base = {
      chainId: 4663,
      protocolKey: 'fixture-launchpad',
      protocolVersion: 'v1',
      tokenAddress: TOKEN0,
      migrationAddress: FACTORY,
      destinationProtocolKey: 'fixture',
      destinationPoolAddress: POOL,
      blockNumber: 100n,
      transactionHash: TX_HASH,
      logIndex: 9,
      canonical: true,
    } as const;
    await context.repository.insertMigration({ ...base, blockHash: BLOCK_HASH });
    await context.repository.markDerivedNonCanonical(4663, 100n, 100n);
    await context.repository.insertMigration({ ...base, blockHash: REPLACEMENT_HASH });
    expect(context.repository.migrations).toHaveLength(2);
    expect(context.repository.migrations.filter((event) => event.canonical)).toHaveLength(1);
  });

  it('ignores logs when the protocol is disabled', async () => {
    const context = harness(false);
    await context.handler.handle(raw(FACTORY, POOL_TOPIC, 1));
    expect(context.repository.pools).toHaveLength(0);
    expect(context.publisher.jobs).toHaveLength(0);
  });

  it('isolates malformed protocol logs from the block path', async () => {
    const context = harness();
    await expect(context.handler.handle({ malformed: true })).resolves.toBeUndefined();
    expect(context.warnings).toContain('Skipping malformed or unsupported protocol event');
  });
});
