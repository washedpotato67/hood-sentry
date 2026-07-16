import {
  type DecodedProtocolEvent,
  type DexAdapter,
  type NormalizedLiquidityEvent,
  type NormalizedPool,
  type NormalizedPoolState,
  type NormalizedQuote,
  type NormalizedSwap,
  type PreparedProtocolTransaction,
  type PriceImpactRequest,
  type PriceImpactResult,
  ProtocolAdapterManager,
  type ProtocolValidationResult,
  type QuoteRequest,
  type RawChainLog,
  type VersionedProtocolRegistry,
} from '@hood-sentry/chain';
import { describe, expect, it } from 'vitest';
import { PoolRefreshJob } from './pool-refresh.js';
import { ProtocolEnrichmentJob } from './protocol-enrichment.js';
import { QuoteValidationJob } from './quote-validation.js';

const FACTORY = '0x1000000000000000000000000000000000000001' as const;
const ROUTER = '0x1000000000000000000000000000000000000002' as const;
const POOL = '0x2000000000000000000000000000000000000001' as const;
const TOKEN0 = '0x3000000000000000000000000000000000000001' as const;
const TOKEN1 = '0x3000000000000000000000000000000000000002' as const;
const HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;

function validation(active = true): ProtocolValidationResult {
  return {
    protocolKey: 'fixture-dex',
    protocolName: 'Fixture DEX',
    protocolVersion: 'v1',
    chainId: 4663,
    kind: 'dex',
    active,
    checkedAt: '2026-07-14T12:00:00.000Z',
    expiresAt: '2026-07-14T12:05:00.000Z',
    failureCode: active ? null : 'bytecode-mismatch',
    errors: active ? [] : ['bytecode changed'],
    contracts: [],
  };
}

function quote(expiresAt = '2026-07-14T12:01:00.000Z'): NormalizedQuote {
  return {
    quoteId: 'fixture-quote',
    chainId: 4663,
    protocolKey: 'fixture-dex',
    protocolVersion: 'v1',
    inputTokenAddress: TOKEN0,
    outputTokenAddress: TOKEN1,
    amountInRaw: 100n,
    expectedAmountOutRaw: 190n,
    minimumAmountOutRaw: 180n,
    route: [
      {
        protocolKey: 'fixture-dex',
        protocolVersion: 'v1',
        poolAddress: POOL,
        inputTokenAddress: TOKEN0,
        outputTokenAddress: TOKEN1,
      },
    ],
    spenderAddress: ROUTER,
    transactionTarget: ROUTER,
    transactionSelector: '0x38ed1739',
    sourceBlockNumber: 100n,
    createdAt: '2026-07-14T12:00:00.000Z',
    expiresAt,
    warnings: [],
  };
}

class FixtureDexAdapter implements DexAdapter {
  readonly protocolKey = 'fixture-dex';
  readonly protocolName = 'Fixture DEX';
  readonly version = 'v1';
  readonly chainId = 4663;
  readonly kind = 'dex';

  constructor(private readonly active = true) {}

  async validateConfiguration(): Promise<ProtocolValidationResult> {
    return validation(this.active);
  }

  getEventDefinitions() {
    return [];
  }

  supportsAddress(address: `0x${string}`): boolean {
    return address.toLowerCase() === POOL.toLowerCase();
  }

  async decodeLog(_log: RawChainLog): Promise<DecodedProtocolEvent | null> {
    return null;
  }

  async discoverPool(_event: DecodedProtocolEvent): Promise<NormalizedPool | null> {
    return null;
  }

  async readPoolState(
    _poolAddress: `0x${string}`,
    _blockNumber?: bigint,
  ): Promise<NormalizedPoolState> {
    return {
      poolType: 'constantProduct',
      reserve0Raw: 1_000n,
      reserve1Raw: 2_000n,
      lpTotalSupplyRaw: 500n,
    };
  }

  async decodeSwap(_log: RawChainLog): Promise<NormalizedSwap | null> {
    return null;
  }

  async decodeLiquidityEvent(_log: RawChainLog): Promise<NormalizedLiquidityEvent | null> {
    return null;
  }

  async getQuote(_request: QuoteRequest): Promise<NormalizedQuote> {
    return quote();
  }

  async prepareSwapTransaction(
    _quote: NormalizedQuote,
    _userAddress: `0x${string}`,
  ): Promise<PreparedProtocolTransaction> {
    throw new Error('Transaction preparation is outside this fixture');
  }

  calculatePriceImpact(_request: PriceImpactRequest): PriceImpactResult {
    return { priceImpactBps: 0n };
  }

  registerPool(_pool: NormalizedPool): void {}
}

const registry: VersionedProtocolRegistry = {
  name: 'Fixture protocols',
  version: '1.0.0',
  createdAt: '2026-07-14T00:00:00.000Z',
  protocols: [
    {
      protocolKey: 'fixture-dex',
      protocolName: 'Fixture DEX',
      protocolVersion: 'v1',
      chainId: 4663,
      kind: 'dex',
      enabled: true,
      contracts: [
        {
          protocolKey: 'fixture-dex',
          protocolName: 'Fixture DEX',
          protocolVersion: 'v1',
          chainId: 4663,
          contractRole: 'factory',
          address: FACTORY,
          officialSourceUrl: 'https://protocol.example/deployments',
          explorerUrl: `https://robinhoodchain.blockscout.com/address/${FACTORY}`,
          verifiedAt: '2026-07-14T00:00:00.000Z',
          runtimeBytecodeHash: HASH,
          enabled: true,
        },
      ],
    },
  ],
};

describe('protocol worker jobs', () => {
  it('persists refreshed protocol validation', async () => {
    let saved = false;
    const job = new ProtocolEnrichmentJob(
      registry,
      {
        async getValidation() {
          return validation();
        },
      },
      {
        async saveProtocolValidation() {
          saved = true;
        },
      },
    );

    const result = await job.run({
      chainId: 4663,
      protocolKey: 'fixture-dex',
      protocolVersion: 'v1',
    });

    expect(result.active).toBe(true);
    expect(saved).toBe(true);
  });

  it('reads and persists pool state at the requested block', async () => {
    let persistedBlock = 0n;
    const manager = new ProtocolAdapterManager([new FixtureDexAdapter()]);
    const job = new PoolRefreshJob(manager, {
      async getPool() {
        return {
          chainId: 4663,
          protocolKey: 'fixture-dex',
          protocolVersion: 'v1',
          poolAddress: POOL,
          factoryAddress: FACTORY,
          token0Address: TOKEN0,
          token1Address: TOKEN1,
          poolType: 'constantProduct',
          createdBlockNumber: 100n,
          createdBlockHash: HASH,
          creationTransactionHash: HASH,
          creationLogIndex: 0,
          canonical: true,
        };
      },
      async updatePoolState(_chainId, _poolAddress, _state, blockNumber) {
        persistedBlock = blockNumber;
      },
    });

    const result = await job.run({
      chainId: 4663,
      protocolKey: 'fixture-dex',
      protocolVersion: 'v1',
      poolAddress: POOL,
      blockNumber: 101n,
      blockHash: HASH,
    });

    expect(result.state).toMatchObject({ reserve0Raw: 1_000n, reserve1Raw: 2_000n });
    expect(persistedBlock).toBe(101n);
  });

  it('persists a fresh quote from an active adapter', async () => {
    let quoteId = '';
    const manager = new ProtocolAdapterManager([new FixtureDexAdapter()]);
    const job = new QuoteValidationJob(manager, {
      async saveQuote(value) {
        quoteId = value.quoteId;
      },
    });

    await expect(
      job.run({
        quote: quote(),
        currentBlockNumber: 102n,
        maximumBlockLag: 5n,
        now: '2026-07-14T12:00:30.000Z',
      }),
    ).resolves.toEqual({ valid: true, idempotencyKey: 'fixture-quote' });
    expect(quoteId).toBe('fixture-quote');
  });

  it('rejects expired, stale, and inactive quotes', async () => {
    const repository = { async saveQuote(_value: NormalizedQuote) {} };
    const activeJob = new QuoteValidationJob(
      new ProtocolAdapterManager([new FixtureDexAdapter()]),
      repository,
    );
    await expect(
      activeJob.run({
        quote: quote('2026-07-14T12:00:00.000Z'),
        currentBlockNumber: 102n,
        maximumBlockLag: 5n,
        now: '2026-07-14T12:00:01.000Z',
      }),
    ).rejects.toThrow('expired');
    await expect(
      activeJob.run({
        quote: quote(),
        currentBlockNumber: 110n,
        maximumBlockLag: 5n,
        now: '2026-07-14T12:00:01.000Z',
      }),
    ).rejects.toThrow('stale');

    const inactiveJob = new QuoteValidationJob(
      new ProtocolAdapterManager([new FixtureDexAdapter(false)]),
      repository,
    );
    await expect(
      inactiveJob.run({
        quote: quote(),
        currentBlockNumber: 101n,
        maximumBlockLag: 5n,
        now: '2026-07-14T12:00:01.000Z',
      }),
    ).rejects.toThrow('inactive');
  });
});
