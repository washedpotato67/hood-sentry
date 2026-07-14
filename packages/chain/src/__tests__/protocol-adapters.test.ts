import {
  type Address,
  type Hex,
  encodeAbiParameters,
  encodeFunctionResult,
  getAddress,
  keccak256,
  padHex,
  parseAbi,
  toEventSelector,
  zeroAddress,
} from 'viem';
import { describe, expect, it } from 'vitest';
import {
  type DecodedProtocolEvent,
  DuplicateProtocolEventError,
  type LaunchpadAdapter,
  MalformedProtocolLogError,
  type NormalizedPool,
  type NormalizedQuote,
  ProtocolAdapterManager,
  type ProtocolDefinition,
  type ProtocolEventDefinition,
  type ProtocolExecutionClient,
  type ProtocolReadRequest,
  type ProtocolSimulationRequest,
  ProtocolValidationService,
  type RawChainLog,
  TransactionPreparationError,
  UNISWAP_V2_SWAP_SELECTOR,
  UniswapV2Adapter,
  UnknownProtocolError,
  type VersionedProtocolRegistry,
  createProtocolAdapterRuntime,
  protocolRegistry as productionProtocolRegistry,
  protocolContractConfigSchema,
  validateProtocolRegistry,
} from '../protocol-adapters/index.js';

const FACTORY = getAddress('0x1000000000000000000000000000000000000001');
const ROUTER = getAddress('0x1000000000000000000000000000000000000002');
const POOL = getAddress('0x2000000000000000000000000000000000000001');
const TOKEN0 = getAddress('0x3000000000000000000000000000000000000001');
const TOKEN1 = getAddress('0x3000000000000000000000000000000000000002');
const SENDER = getAddress('0x4000000000000000000000000000000000000001');
const RECIPIENT = getAddress('0x4000000000000000000000000000000000000002');
const BYTECODE = '0x6000' as const;
const BYTECODE_HASH = keccak256(BYTECODE);
const BLOCK_HASH = `0x${'a'.repeat(64)}` as const;
const TX_HASH = `0x${'b'.repeat(64)}` as const;

const eventTopics = {
  pool: toEventSelector('PairCreated(address,address,address,uint256)'),
  swap: toEventSelector('Swap(address,uint256,uint256,uint256,uint256,address)'),
  mint: toEventSelector('Mint(address,uint256,uint256)'),
  burn: toEventSelector('Burn(address,uint256,uint256,address)'),
};

function contract(role: ProtocolDefinition['contracts'][number]['contractRole'], address: Address) {
  return {
    protocolKey: 'fixture-dex',
    protocolName: 'Fixture DEX',
    protocolVersion: 'v1',
    chainId: 4663,
    contractRole: role,
    address,
    officialSourceUrl: 'https://protocol.example/deployments',
    explorerUrl: `https://robinhoodchain.blockscout.com/address/${address}`,
    verifiedAt: '2026-07-14T00:00:00.000Z',
    runtimeBytecodeHash: BYTECODE_HASH,
    enabled: true,
  } as const;
}

function definition(): ProtocolDefinition {
  return {
    protocolKey: 'fixture-dex',
    protocolName: 'Fixture DEX',
    protocolVersion: 'v1',
    chainId: 4663,
    kind: 'dex',
    enabled: true,
    contracts: [contract('factory', FACTORY), contract('router', ROUTER)],
  };
}

function registry(
  protocols: readonly ProtocolDefinition[] = [definition()],
): VersionedProtocolRegistry {
  return {
    name: 'Fixture protocols',
    version: '1.0.0',
    createdAt: '2026-07-14T00:00:00.000Z',
    protocols,
  };
}

class MockProtocolClient implements ProtocolExecutionClient {
  chainId = 4663;
  bytecode: Hex = BYTECODE;
  canonicalPool = POOL;
  providerError: Error | null = null;
  simulationSuccess = true;
  codeReads = 0;

  async getChainId(): Promise<number> {
    if (this.providerError !== null) throw this.providerError;
    return this.chainId;
  }

  async getBytecode(): Promise<Hex> {
    this.codeReads++;
    if (this.providerError !== null) throw this.providerError;
    return this.bytecode;
  }

  async getStorageAt(): Promise<Hex> {
    return '0x';
  }

  async getBlockNumber(): Promise<bigint> {
    return 1_000n;
  }

  async getBlockTimestamp(): Promise<bigint> {
    return 1_000n;
  }

  async readContract(request: ProtocolReadRequest): Promise<unknown> {
    switch (request.functionName) {
      case 'token0':
        return TOKEN0;
      case 'token1':
        return TOKEN1;
      case 'factory':
        return FACTORY;
      case 'getPair':
        return this.canonicalPool;
      case 'getReserves':
        return [1_000_000n, 2_000_000n, 100] as const;
      case 'totalSupply':
        return 500_000n;
      case 'getAmountsOut':
        return [10_000n, 19_000n];
      default:
        throw new Error(`Unexpected read ${request.functionName}`);
    }
  }

  async simulateTransaction(
    _request: ProtocolSimulationRequest,
  ): Promise<{ success: boolean; gasUsed: bigint; returnValue: Hex; error?: string }> {
    if (!this.simulationSuccess) {
      return { success: false, gasUsed: 0n, returnValue: '0x', error: 'simulation reverted' };
    }
    return {
      success: true,
      gasUsed: 120_000n,
      returnValue: encodeFunctionResult({
        abi: parseAbi([
          'function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[] amounts)',
        ]),
        functionName: 'swapExactTokensForTokens',
        result: [10_000n, 19_000n],
      }),
    };
  }
}

function indexed(address: Address): Hex {
  return padHex(address, { size: 32 });
}

function log(address: Address, topics: readonly Hex[], data: Hex, logIndex = 1): RawChainLog {
  return {
    chainId: 4663,
    blockNumber: 900n,
    blockHash: BLOCK_HASH,
    transactionHash: TX_HASH,
    transactionIndex: 2,
    logIndex,
    address,
    topics,
    data,
    removed: false,
    canonical: true,
  };
}

function poolLog(factory = FACTORY): RawChainLog {
  return log(
    factory,
    [eventTopics.pool, indexed(TOKEN0), indexed(TOKEN1)],
    encodeAbiParameters(
      [
        { name: 'pair', type: 'address' },
        { name: 'pairCount', type: 'uint256' },
      ],
      [POOL, 1n],
    ),
  );
}

async function setup(now: () => Date = () => new Date('2026-07-14T12:00:00.000Z')) {
  const client = new MockProtocolClient();
  const protocolDefinition = definition();
  const validation = new ProtocolValidationService(registry(), client, { now });
  await validation.initialize();
  const adapter = new UniswapV2Adapter(
    protocolDefinition,
    client,
    validation,
    { async assertTradingEnabled() {} },
    { now },
  );
  const manager = new ProtocolAdapterManager([adapter]);
  return { client, validation, adapter, manager };
}

async function setupPool() {
  const context = await setup();
  const routed = await context.manager.routeLog(poolLog());
  if (
    routed?.normalized === null ||
    routed === null ||
    !('createdBlockNumber' in routed.normalized)
  ) {
    throw new Error('Fixture pool was not created');
  }
  return { ...context, pool: routed.normalized };
}

function route(pool: NormalizedPool) {
  return [
    {
      protocolKey: 'fixture-dex',
      protocolVersion: 'v1',
      poolAddress: pool.poolAddress,
      inputTokenAddress: TOKEN0,
      outputTokenAddress: TOKEN1,
      feeTier: 3_000n,
    },
  ] as const;
}

async function quote(adapter: UniswapV2Adapter, pool: NormalizedPool): Promise<NormalizedQuote> {
  return adapter.getQuote({
    chainId: 4663,
    protocolKey: 'fixture-dex',
    inputTokenAddress: TOKEN0,
    outputTokenAddress: TOKEN1,
    amountInRaw: 10_000n,
    minimumAmountOutRaw: 18_000n,
    route: route(pool),
  });
}

describe('protocol registry validation', () => {
  it('validates the production protocol registry', () => {
    expect(validateProtocolRegistry(productionProtocolRegistry)).toEqual(
      productionProtocolRegistry,
    );
  });

  it('validates a versioned registry', () => {
    expect(validateProtocolRegistry(registry())).toEqual(registry());
  });

  it('rejects the zero address', () => {
    const value = { ...contract('factory', FACTORY), address: zeroAddress };
    expect(protocolContractConfigSchema.safeParse(value).success).toBe(false);
  });

  it('rejects duplicate protocol roles', () => {
    const duplicate = {
      ...definition(),
      contracts: [contract('factory', FACTORY), contract('factory', ROUTER)],
    };
    expect(() => validateProtocolRegistry(registry([duplicate]))).toThrow(
      'duplicate factory roles',
    );
  });

  it('disables a protocol on the wrong chain', async () => {
    const client = new MockProtocolClient();
    client.chainId = 46630;
    const result = await new ProtocolValidationService(registry(), client).initialize();
    expect(result[0]).toMatchObject({ active: false, failureCode: 'wrong-chain' });
  });

  it('disables a protocol after bytecode mismatch and emits an alert', async () => {
    const client = new MockProtocolClient();
    client.bytecode = '0x6001';
    const alerts: string[] = [];
    const result = await new ProtocolValidationService(registry(), client, {
      onAlert: (alert) => {
        alerts.push(alert.code);
      },
    }).initialize();
    expect(result[0]).toMatchObject({ active: false, failureCode: 'bytecode-mismatch' });
    expect(result[0]?.contracts).toHaveLength(2);
    expect(alerts).toEqual(['bytecode-mismatch']);
  });

  it('reports provider outage without activating the adapter', async () => {
    const client = new MockProtocolClient();
    client.providerError = new Error('provider offline');
    const result = await new ProtocolValidationService(registry(), client).initialize();
    expect(result[0]).toMatchObject({ active: false, failureCode: 'provider-outage' });
  });

  it('uses cached validation until stale', async () => {
    const client = new MockProtocolClient();
    let now = new Date('2026-07-14T00:00:00.000Z');
    const validation = new ProtocolValidationService(registry(), client, {
      cacheTtlMs: 1_000,
      now: () => now,
    });
    await validation.initialize();
    const reads = client.codeReads;
    await validation.assertActive('fixture-dex', 'v1', 4663);
    expect(client.codeReads).toBe(reads);
    now = new Date(now.getTime() + 1_001);
    await validation.assertActive('fixture-dex', 'v1', 4663);
    expect(client.codeReads).toBeGreaterThan(reads);
  });

  it('disables a protocol when bytecode changes after the cache expires', async () => {
    const client = new MockProtocolClient();
    let now = new Date('2026-07-14T00:00:00.000Z');
    const validation = new ProtocolValidationService(registry(), client, {
      cacheTtlMs: 1_000,
      now: () => now,
    });
    await validation.initialize();
    client.bytecode = '0x6001';
    now = new Date(now.getTime() + 1_001);

    await expect(validation.assertActive('fixture-dex', 'v1', 4663)).rejects.toThrow(
      'bytecode hash',
    );
    expect(validation.getCachedResults()[0]).toMatchObject({
      active: false,
      failureCode: 'bytecode-mismatch',
    });
  });

  it('rejects a proxy implementation disagreement', async () => {
    const proxyDefinition: ProtocolDefinition = {
      ...definition(),
      contracts: [
        {
          ...contract('factory', FACTORY),
          proxyType: 'eip1967',
          implementationAddress: getAddress('0x5000000000000000000000000000000000000001'),
        },
        contract('router', ROUTER),
      ],
    };
    const result = await new ProtocolValidationService(
      registry([proxyDefinition]),
      new MockProtocolClient(),
    ).initialize();
    expect(result[0]).toMatchObject({ active: false, failureCode: 'proxy-mismatch' });
  });

  it('reports adapter initialization failure without activating the adapter', async () => {
    const client = new MockProtocolClient();
    const validation = new ProtocolValidationService(registry(), client);
    const runtime = await createProtocolAdapterRuntime({
      registry: registry(),
      chainId: 4663,
      client,
      validation,
      featurePolicy: { async assertTradingEnabled() {} },
      factories: [
        {
          protocolKey: 'fixture-dex',
          protocolVersion: 'v1',
          create() {
            throw new Error('fixture initialization failed');
          },
        },
      ],
    });

    expect(runtime.initializationErrors).toEqual(['fixture initialization failed']);
    expect(runtime.manager.getActiveAdapters()).toEqual([]);
  });
});

describe('DEX adapter normalization and transaction controls', () => {
  it('discovers a pool from a verified factory and direct token reads', async () => {
    const { manager } = await setup();
    const routed = await manager.routeLog(poolLog());
    expect(routed?.normalized).toMatchObject({
      protocolKey: 'fixture-dex',
      poolAddress: POOL,
      factoryAddress: FACTORY,
      token0Address: TOKEN0,
      token1Address: TOKEN1,
      feeTier: 3_000n,
      canonical: true,
    });
  });

  it('returns null for an unknown factory and throws for an unknown protocol lookup', async () => {
    const { manager } = await setup();
    const unknownFactory = getAddress('0x9000000000000000000000000000000000000001');
    await expect(manager.routeLog(poolLog(unknownFactory))).resolves.toBeNull();
    expect(() => manager.getAdapter('unknown', 'v1', 4663)).toThrow(UnknownProtocolError);
  });

  it('decodes swaps without token decimal normalization', async () => {
    const { manager, pool } = await setupPool();
    const amountIn = 123_456_789_012_345_678_901_234n;
    const amountOut = 9_876_543_210n;
    const routed = await manager.routeLog(
      log(
        pool.poolAddress,
        [eventTopics.swap, indexed(SENDER), indexed(RECIPIENT)],
        encodeAbiParameters(
          [
            { name: 'amount0In', type: 'uint256' },
            { name: 'amount1In', type: 'uint256' },
            { name: 'amount0Out', type: 'uint256' },
            { name: 'amount1Out', type: 'uint256' },
          ],
          [amountIn, 0n, 0n, amountOut],
        ),
        2,
      ),
    );
    expect(routed?.normalized).toMatchObject({
      tokenInAddress: TOKEN0,
      tokenOutAddress: TOKEN1,
      amountInRaw: amountIn,
      amountOutRaw: amountOut,
    });
  });

  it.each([
    ['liquidityAdded', eventTopics.mint, [eventTopics.mint, indexed(SENDER)]],
    ['liquidityRemoved', eventTopics.burn, [eventTopics.burn, indexed(SENDER), indexed(RECIPIENT)]],
  ] as const)('decodes %s', async (eventType, _topic, logTopics) => {
    const { manager, pool } = await setupPool();
    const routed = await manager.routeLog(
      log(
        pool.poolAddress,
        logTopics,
        encodeAbiParameters(
          [
            { name: 'amount0', type: 'uint256' },
            { name: 'amount1', type: 'uint256' },
          ],
          [100n, 200n],
        ),
        eventType === 'liquidityAdded' ? 3 : 4,
      ),
    );
    expect(routed?.normalized).toMatchObject({ eventType, amount0Raw: 100n, amount1Raw: 200n });
  });

  it('rejects malformed logs and ignores unsupported events', async () => {
    const { manager, pool } = await setupPool();
    await expect(manager.routeLog({ ...poolLog(), data: '0x12' })).rejects.toThrow(
      MalformedProtocolLogError,
    );
    await expect(
      manager.routeLog(log(pool.poolAddress, [`0x${'f'.repeat(64)}`], '0x', 5)),
    ).resolves.toBeNull();
  });

  it('rejects an unsupported fee tier', async () => {
    const { adapter, pool } = await setupPool();
    await expect(
      adapter.getQuote({
        chainId: 4663,
        protocolKey: 'fixture-dex',
        inputTokenAddress: TOKEN0,
        outputTokenAddress: TOKEN1,
        amountInRaw: 10_000n,
        minimumAmountOutRaw: 18_000n,
        route: [{ ...route(pool)[0], feeTier: 500n }],
      }),
    ).rejects.toThrow('does not support fee tier');
  });

  it('prepares only a fresh server-issued quote with allowlisted fields', async () => {
    const { adapter, pool } = await setupPool();
    const issued = await quote(adapter, pool);
    const transaction = await adapter.prepareSwapTransaction(issued, SENDER);
    expect(transaction).toMatchObject({
      to: ROUTER,
      spenderAddress: ROUTER,
      functionSelector: UNISWAP_V2_SWAP_SELECTOR,
      simulation: { success: true },
    });
  });

  it.each([
    ['spender', (value: NormalizedQuote) => ({ ...value, spenderAddress: FACTORY })],
    ['target', (value: NormalizedQuote) => ({ ...value, transactionTarget: FACTORY })],
    [
      'selector',
      (value: NormalizedQuote) => ({ ...value, transactionSelector: '0x12345678' as const }),
    ],
  ])('rejects a wrong %s', async (_name, mutate) => {
    const { adapter, pool } = await setupPool();
    const issued = await quote(adapter, pool);
    await expect(adapter.prepareSwapTransaction(mutate(issued), SENDER)).rejects.toThrow(
      TransactionPreparationError,
    );
  });

  it('rejects expired quotes', async () => {
    let now = new Date('2026-07-14T12:00:00.000Z');
    const context = await setup(() => now);
    const routed = await context.manager.routeLog(poolLog());
    if (
      routed?.normalized === null ||
      routed === null ||
      !('createdBlockNumber' in routed.normalized)
    ) {
      throw new Error('Fixture pool was not created');
    }
    const issued = await quote(context.adapter, routed.normalized);
    now = new Date('2026-07-14T12:01:00.000Z');
    await expect(context.adapter.prepareSwapTransaction(issued, SENDER)).rejects.toThrow(
      'Quote has expired',
    );
  });

  it('rejects a failed simulation', async () => {
    const { adapter, client, pool } = await setupPool();
    const issued = await quote(adapter, pool);
    client.simulationSuccess = false;
    await expect(adapter.prepareSwapTransaction(issued, SENDER)).rejects.toThrow(
      'simulation reverted',
    );
  });

  it('rejects duplicate normalized events', async () => {
    const { manager } = await setup();
    await manager.routeLog(poolLog());
    await expect(manager.routeLog(poolLog())).rejects.toThrow(DuplicateProtocolEventError);
  });
});

const launchTopics = {
  token: toEventSelector('TokenCreated(address,address,uint256,address)'),
  buy: toEventSelector('CurveBuy(address,address,uint256,uint256)'),
  sell: toEventSelector('CurveSell(address,address,uint256,uint256)'),
  graduation: toEventSelector('Graduated(address,uint256)'),
  migration: toEventSelector('Migrated(address,string,address)'),
};

const launchKinds: ReadonlyMap<string, DecodedProtocolEvent['kind']> = new Map([
  [launchTopics.token.toLowerCase(), 'launchpadTokenCreated'],
  [launchTopics.buy.toLowerCase(), 'bondingCurveBuy'],
  [launchTopics.sell.toLowerCase(), 'bondingCurveSell'],
  [launchTopics.graduation.toLowerCase(), 'launchpadGraduated'],
  [launchTopics.migration.toLowerCase(), 'launchpadMigrated'],
]);

class FixtureLaunchpadAdapter implements LaunchpadAdapter {
  readonly protocolKey = 'fixture-launchpad';
  readonly protocolName = 'Fixture Launchpad';
  readonly version = 'v1';
  readonly chainId = 4663;
  readonly kind = 'launchpad' as const;
  readonly address = getAddress('0x7000000000000000000000000000000000000001');

  async validateConfiguration() {
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
    } as const;
  }

  getEventDefinitions(): readonly ProtocolEventDefinition[] {
    return [];
  }

  supportsAddress(address: Address): boolean {
    return address.toLowerCase() === this.address.toLowerCase();
  }

  async decodeLog(raw: RawChainLog) {
    const topic = raw.topics[0]?.toLowerCase();
    const kind = topic === undefined ? undefined : launchKinds.get(topic);
    if (kind === undefined) return null;
    return {
      protocolKey: this.protocolKey,
      protocolName: this.protocolName,
      protocolVersion: this.version,
      kind,
      emitterAddress: raw.address,
      provenance: {
        chainId: raw.chainId,
        blockNumber: raw.blockNumber,
        blockHash: raw.blockHash,
        transactionHash: raw.transactionHash,
        transactionIndex: raw.transactionIndex,
        logIndex: raw.logIndex,
        canonical: raw.canonical,
      },
      fields: {},
    } as const;
  }

  async decodeTokenCreation(raw: RawChainLog) {
    if (raw.topics[0]?.toLowerCase() !== launchTopics.token.toLowerCase()) return null;
    return {
      ...this.base(raw),
      tokenAddress: TOKEN0,
      creatorAddress: SENDER,
      initialSupplyRaw: 1_000_000n,
      bondingCurveAddress: this.address,
    };
  }

  async decodeBondingCurveTrade(raw: RawChainLog) {
    const topic = raw.topics[0]?.toLowerCase();
    if (topic !== launchTopics.buy.toLowerCase() && topic !== launchTopics.sell.toLowerCase()) {
      return null;
    }
    return {
      ...this.base(raw),
      tokenAddress: TOKEN0,
      bondingCurveAddress: this.address,
      traderAddress: SENDER,
      side: topic === launchTopics.buy.toLowerCase() ? ('buy' as const) : ('sell' as const),
      tokenAmountRaw: 100n,
      paymentAmountRaw: 10n,
    };
  }

  async decodeGraduation(raw: RawChainLog) {
    if (raw.topics[0]?.toLowerCase() !== launchTopics.graduation.toLowerCase()) return null;
    return {
      ...this.base(raw),
      tokenAddress: TOKEN0,
      bondingCurveAddress: this.address,
      graduationThresholdRaw: 1_000n,
    };
  }

  async decodeMigration(raw: RawChainLog) {
    if (raw.topics[0]?.toLowerCase() !== launchTopics.migration.toLowerCase()) return null;
    return {
      ...this.base(raw),
      tokenAddress: TOKEN0,
      migrationAddress: this.address,
      destinationProtocolKey: 'fixture-dex',
      destinationPoolAddress: POOL,
    };
  }

  async readLaunchState() {
    return {
      tokenAddress: TOKEN0,
      bondingCurveAddress: this.address,
      curveProgressBps: 5_000n,
      graduated: false,
      sourceBlockNumber: 900n,
      available: true,
    };
  }

  private base(raw: RawChainLog) {
    return {
      chainId: raw.chainId,
      protocolKey: this.protocolKey,
      protocolVersion: this.version,
      blockNumber: raw.blockNumber,
      blockHash: raw.blockHash,
      transactionHash: raw.transactionHash,
      logIndex: raw.logIndex,
      canonical: raw.canonical,
    };
  }
}

describe('launchpad adapter routing with test-only fixtures', () => {
  it.each([
    ['launchpadTokenCreated', launchTopics.token, 'initialSupplyRaw'],
    ['bondingCurveBuy', launchTopics.buy, 'side'],
    ['bondingCurveSell', launchTopics.sell, 'side'],
    ['launchpadGraduated', launchTopics.graduation, 'graduationThresholdRaw'],
    ['launchpadMigrated', launchTopics.migration, 'destinationPoolAddress'],
  ] as const)('normalizes %s', async (_kind, topic, expectedField) => {
    const adapter = new FixtureLaunchpadAdapter();
    const manager = new ProtocolAdapterManager([adapter]);
    const result = await manager.routeLog(log(adapter.address, [topic], '0x'));
    expect(result?.normalized).toHaveProperty(expectedField);
  });

  it('rejects a duplicate migration event', async () => {
    const adapter = new FixtureLaunchpadAdapter();
    const manager = new ProtocolAdapterManager([adapter]);
    const migration = log(adapter.address, [launchTopics.migration], '0x');
    await manager.routeLog(migration);
    await expect(manager.routeLog(migration)).rejects.toThrow(DuplicateProtocolEventError);
  });
});
