import {
  type Address,
  type Hex,
  encodeAbiParameters,
  getAddress,
  keccak256,
  padHex,
  toEventSelector,
} from 'viem';
import { describe, expect, it } from 'vitest';
import {
  DuplicatePoolEventError,
  MalformedProtocolLogError,
  ProtocolAdapterManager,
  type ProtocolExecutionClient,
  type ProtocolLog,
  type ProtocolReadClient,
  type ProtocolReadRequest,
  type ProtocolRoute,
  UniswapV2Adapter,
  UnknownFactoryError,
  UnknownPoolError,
  UnsupportedFeeTierError,
  UnverifiedProtocolContractError,
  createProtocolAdapterManager,
} from '../protocol-adapters/index.js';
import { dexRegistry } from '../registries/dex.js';
import type { DexContractEntry, Registry } from '../types.js';

const TOKEN0 = getAddress('0x1111111111111111111111111111111111111111');
const TOKEN1 = getAddress('0x2222222222222222222222222222222222222222');
const POOL = getAddress('0x3333333333333333333333333333333333333333');
const SENDER = getAddress('0x4444444444444444444444444444444444444444');
const RECIPIENT = getAddress('0x5555555555555555555555555555555555555555');
const UNKNOWN = getAddress('0x6666666666666666666666666666666666666666');

const HASH_A = `0x${'a'.repeat(64)}` as const;
const HASH_B = `0x${'b'.repeat(64)}` as const;
const TEST_BYTECODE = '0x6000' as const;

const topics = {
  poolCreated: toEventSelector('PairCreated(address,address,address,uint256)'),
  swap: toEventSelector('Swap(address,uint256,uint256,uint256,uint256,address)'),
  mint: toEventSelector('Mint(address,uint256,uint256)'),
  burn: toEventSelector('Burn(address,uint256,uint256,address)'),
};

function indexed(address: Address): Hex {
  return padHex(address, { size: 32 });
}

function baseLog(address: Address, eventTopics: readonly Hex[], data: Hex): ProtocolLog {
  return {
    chainId: 4663,
    blockNumber: 100n,
    blockHash: HASH_A,
    transactionHash: HASH_B,
    logIndex: 7,
    address,
    topics: eventTopics,
    data,
  };
}

function setup() {
  const adapter = new UniswapV2Adapter(dexRegistry, 4663);
  const manager = new ProtocolAdapterManager([adapter]);
  return { adapter, manager };
}

function poolCreationLog(factory: Address): ProtocolLog {
  return baseLog(
    factory,
    [topics.poolCreated, indexed(TOKEN0), indexed(TOKEN1)],
    encodeAbiParameters(
      [
        { name: 'pair', type: 'address' },
        { name: 'pairCount', type: 'uint256' },
      ],
      [POOL, 1n],
    ),
  );
}

function registerPool() {
  const context = setup();
  const pool = context.manager.discoverPool(
    poolCreationLog(context.adapter.manifest.factory.address),
  );
  return { ...context, pool };
}

class UnverifiedReadClient implements ProtocolReadClient {
  async getChainId(): Promise<number> {
    return 4663;
  }

  async getBytecode(): Promise<Hex> {
    return '0x1234';
  }

  async getBlockNumber(): Promise<bigint> {
    return 100n;
  }

  async getBlockTimestamp(): Promise<bigint> {
    return 1_000n;
  }

  async readContract(): Promise<unknown> {
    throw new Error('readContract must remain blocked');
  }
}

class UnverifiedExecutionClient extends UnverifiedReadClient implements ProtocolExecutionClient {
  async simulateTransaction(): Promise<{ success: boolean }> {
    throw new Error('simulation must remain blocked');
  }
}

class VerifiedExecutionClient implements ProtocolExecutionClient {
  constructor(private readonly canonicalPool: Address = POOL) {}

  async getChainId(): Promise<number> {
    return 4663;
  }

  async getBytecode(): Promise<Hex> {
    return TEST_BYTECODE;
  }

  async getBlockNumber(): Promise<bigint> {
    return 100n;
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
        return dexRegistry.entries.find((entry) => entry.dexType === 'factory')?.address;
      case 'getPair':
        return this.canonicalPool;
      case 'getAmountsOut':
        return [100n, 90n];
      default:
        throw new Error(`Unexpected contract read: ${request.functionName}`);
    }
  }

  async simulateTransaction(): Promise<{ success: boolean }> {
    return { success: true };
  }
}

function locallyVerifiedAdapter(): UniswapV2Adapter {
  const registry: Registry<DexContractEntry> = {
    ...dexRegistry,
    entries: dexRegistry.entries.map((entry) => ({
      ...entry,
      runtimeBytecodeHash: keccak256(TEST_BYTECODE),
    })),
  };
  return new UniswapV2Adapter(registry, 4663);
}

function route(): ProtocolRoute {
  return {
    chainId: 4663,
    tokenIn: TOKEN0,
    tokenOut: TOKEN1,
    legs: [
      {
        protocol: 'uniswap',
        version: 'v2',
        poolAddress: POOL,
        tokenIn: TOKEN0,
        tokenOut: TOKEN1,
        fee: 3_000,
      },
    ],
  };
}

describe('protocol adapter system', () => {
  it('builds the generic manager from verified registry entries', () => {
    expect(() => createProtocolAdapterManager(dexRegistry, 4663)).not.toThrow();
  });

  it('rejects a protocol registry role without a runtime bytecode hash', () => {
    const unverifiedRegistry: Registry<DexContractEntry> = {
      ...dexRegistry,
      entries: dexRegistry.entries.map((entry) =>
        entry.dexType === 'router' ? { ...entry, runtimeBytecodeHash: null } : entry,
      ),
    };

    expect(() => new UniswapV2Adapter(unverifiedRegistry, 4663)).toThrow(
      UnverifiedProtocolContractError,
    );
  });

  it('loads only verified deployment roles and normalizes pool creation', () => {
    const { adapter, manager } = setup();
    const pool = manager.discoverPool(poolCreationLog(adapter.manifest.factory.address));

    expect(adapter.manifest).toMatchObject({
      chainId: 4663,
      protocol: 'uniswap',
      version: 'v2',
      quoter: null,
      positionManager: null,
      permit2: null,
      supportedFeeTiers: [3_000],
    });
    expect(adapter.manifest.factory.runtimeBytecodeHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(adapter.manifest.router?.runtimeBytecodeHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(pool).toMatchObject({
      address: POOL,
      token0: TOKEN0,
      token1: TOKEN1,
      fee: 3_000,
      state: { model: 'constant-product', reserve0: 0n, reserve1: 0n },
      provenance: { blockNumber: 100n, transactionHash: HASH_B, logIndex: 7 },
    });
  });

  it('decodes a normalized swap with direction and block provenance', () => {
    const { manager, pool } = registerPool();
    const log = baseLog(
      pool.address,
      [topics.swap, indexed(SENDER), indexed(RECIPIENT)],
      encodeAbiParameters(
        [
          { name: 'amount0In', type: 'uint256' },
          { name: 'amount1In', type: 'uint256' },
          { name: 'amount0Out', type: 'uint256' },
          { name: 'amount1Out', type: 'uint256' },
        ],
        [100n, 0n, 0n, 90n],
      ),
    );

    expect(manager.decodePoolEvent(log)).toMatchObject({
      kind: 'swap',
      direction: 'token0-to-token1',
      amountIn: 100n,
      amountOut: 90n,
      sender: SENDER,
      recipient: RECIPIENT,
      provenance: { blockHash: HASH_A, transactionHash: HASH_B },
    });
  });

  it('decodes a normalized liquidity addition', () => {
    const { manager, pool } = registerPool();
    const log = baseLog(
      pool.address,
      [topics.mint, indexed(SENDER)],
      encodeAbiParameters(
        [
          { name: 'amount0', type: 'uint256' },
          { name: 'amount1', type: 'uint256' },
        ],
        [500n, 600n],
      ),
    );

    expect(manager.decodePoolEvent(log)).toMatchObject({
      kind: 'liquidity-addition',
      amount0: 500n,
      amount1: 600n,
      sender: SENDER,
      recipient: null,
    });
  });

  it('decodes a normalized liquidity removal', () => {
    const { manager, pool } = registerPool();
    const log = baseLog(
      pool.address,
      [topics.burn, indexed(SENDER), indexed(RECIPIENT)],
      encodeAbiParameters(
        [
          { name: 'amount0', type: 'uint256' },
          { name: 'amount1', type: 'uint256' },
        ],
        [200n, 300n],
      ),
    );

    expect(manager.decodePoolEvent(log)).toMatchObject({
      kind: 'liquidity-removal',
      amount0: 200n,
      amount1: 300n,
      sender: SENDER,
      recipient: RECIPIENT,
    });
  });

  it('rejects a malformed factory log', () => {
    const { adapter, manager } = setup();
    const malformed = baseLog(
      adapter.manifest.factory.address,
      [topics.poolCreated, indexed(TOKEN0), indexed(TOKEN1)],
      '0x12',
    );

    expect(() => manager.discoverPool(malformed)).toThrow(MalformedProtocolLogError);
  });

  it('rejects an unsupported fee tier', () => {
    const { adapter } = setup();
    expect(() => adapter.assertSupportedFeeTier(500)).toThrow(UnsupportedFeeTierError);
  });

  it('rejects an unknown factory', () => {
    const { manager } = setup();
    expect(() => manager.discoverPool(poolCreationLog(UNKNOWN))).toThrow(UnknownFactoryError);
  });

  it('rejects a duplicate pool creation event', () => {
    const { adapter, manager } = setup();
    const log = poolCreationLog(adapter.manifest.factory.address);
    manager.discoverPool(log);
    expect(() => manager.discoverPool(log)).toThrow(DuplicatePoolEventError);
  });

  it('rejects a pool event emitted from the wrong protocol address', () => {
    const { manager } = registerPool();
    const wrongAddressLog = baseLog(
      UNKNOWN,
      [topics.swap, indexed(SENDER), indexed(RECIPIENT)],
      encodeAbiParameters(
        [
          { name: 'amount0In', type: 'uint256' },
          { name: 'amount1In', type: 'uint256' },
          { name: 'amount0Out', type: 'uint256' },
          { name: 'amount1Out', type: 'uint256' },
        ],
        [100n, 0n, 0n, 90n],
      ),
    );

    expect(() => manager.decodePoolEvent(wrongAddressLog)).toThrow(UnknownPoolError);
  });

  it('blocks quotes when runtime bytecode differs from the verified registry', async () => {
    const { adapter } = setup();
    await expect(
      adapter.quote(new UnverifiedReadClient(), { route: route(), amountIn: 100n }),
    ).rejects.toThrow(UnverifiedProtocolContractError);
  });

  it('blocks transaction preparation before simulation when runtime bytecode differs', async () => {
    const { adapter } = setup();
    await expect(
      adapter.prepareTransaction(new UnverifiedExecutionClient(), {
        sender: SENDER,
        recipient: RECIPIENT,
        route: route(),
        amountIn: 100n,
        minimumAmountOut: 90n,
        deadline: 1_300n,
      }),
    ).rejects.toThrow(UnverifiedProtocolContractError);
  });

  it('rejects a route pool missing from the verified factory mapping', async () => {
    const adapter = locallyVerifiedAdapter();
    await expect(
      adapter.quote(new VerifiedExecutionClient(UNKNOWN), { route: route(), amountIn: 100n }),
    ).rejects.toThrow(UnverifiedProtocolContractError);
  });

  it('quotes and prepares a swap through verified canonical contracts', async () => {
    const adapter = locallyVerifiedAdapter();
    const client = new VerifiedExecutionClient();

    await expect(adapter.quote(client, { route: route(), amountIn: 100n })).resolves.toMatchObject({
      amountIn: 100n,
      amountOut: 90n,
      blockNumber: 100n,
    });
    await expect(
      adapter.prepareTransaction(client, {
        sender: SENDER,
        recipient: RECIPIENT,
        route: route(),
        amountIn: 100n,
        minimumAmountOut: 90n,
        deadline: 1_300n,
      }),
    ).resolves.toMatchObject({
      chainId: 4663,
      to: adapter.manifest.router?.address,
      deadline: 1_300n,
      intent: { amountIn: 100n, minimumAmountOut: 90n, recipient: RECIPIENT },
    });
  });
});
