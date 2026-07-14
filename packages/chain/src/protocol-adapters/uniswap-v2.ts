import {
  type Address,
  type Hex,
  decodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  toEventSelector,
} from 'viem';
import { z } from 'zod';
import type { DexContractEntry, Registry, SupportedChainId } from '../types.js';
import { loadVerifiedProtocolManifest } from './deployment.js';
import {
  MalformedProtocolLogError,
  UnsupportedFeeTierError,
  UnverifiedProtocolContractError,
} from './errors.js';
import { getProvenance } from './log.js';
import type {
  BlockProvenance,
  NormalizedLiquidityChange,
  NormalizedPool,
  NormalizedPoolState,
  NormalizedSwap,
  PreparedProtocolTransaction,
  PriceImpactRequest,
  PriceImpactResult,
  ProtocolAdapter,
  ProtocolAdapterManifest,
  ProtocolExecutionClient,
  ProtocolLog,
  ProtocolQuote,
  ProtocolReadClient,
  ProtocolRoute,
  QuoteRequest,
  TransactionPreparationRequest,
  VerifiedProtocolContract,
} from './types.js';

export const UNISWAP_V2_FEE = 3_000;

const eventSignatures = {
  poolCreated: 'PairCreated(address,address,address,uint256)',
  swap: 'Swap(address,uint256,uint256,uint256,uint256,address)',
  liquidityAdded: 'Mint(address,uint256,uint256)',
  liquidityRemoved: 'Burn(address,uint256,uint256,address)',
} as const;

const eventTopics = {
  poolCreated: toEventSelector(eventSignatures.poolCreated),
  swap: toEventSelector(eventSignatures.swap),
  liquidityAdded: toEventSelector(eventSignatures.liquidityAdded),
  liquidityRemoved: toEventSelector(eventSignatures.liquidityRemoved),
} as const;

const factoryDataParameters = [
  { name: 'pair', type: 'address' },
  { name: 'pairCount', type: 'uint256' },
] as const;

const swapDataParameters = [
  { name: 'amount0In', type: 'uint256' },
  { name: 'amount1In', type: 'uint256' },
  { name: 'amount0Out', type: 'uint256' },
  { name: 'amount1Out', type: 'uint256' },
] as const;

const liquidityDataParameters = [
  { name: 'amount0', type: 'uint256' },
  { name: 'amount1', type: 'uint256' },
] as const;

const pairAbi = parseAbi([
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function factory() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function totalSupply() view returns (uint256)',
]);

const factoryAbi = parseAbi([
  'function getPair(address tokenA, address tokenB) view returns (address pair)',
]);

const routerAbi = parseAbi([
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
]);

const addressResultSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((address) => getAddress(address));
const reservesResultSchema = z.tuple([
  z.bigint().nonnegative(),
  z.bigint().nonnegative(),
  z.union([z.number().int().nonnegative(), z.bigint().nonnegative()]),
]);
const quoteResultSchema = z.array(z.bigint().nonnegative()).min(2);

function indexedAddress(topic: Hex | undefined, field: string): Address {
  if (topic === undefined || topic.length !== 66) {
    throw new MalformedProtocolLogError(`Missing indexed ${field} address`);
  }
  return getAddress(`0x${topic.slice(-40)}`);
}

function assertEvent(log: ProtocolLog, topic: Hex, expectedTopics: number): void {
  if (
    log.topics[0]?.toLowerCase() !== topic.toLowerCase() ||
    log.topics.length !== expectedTopics
  ) {
    throw new MalformedProtocolLogError('Protocol event topics are malformed');
  }
}

function decodeData<T>(operation: () => T): T {
  try {
    return operation();
  } catch {
    throw new MalformedProtocolLogError('Protocol event data failed ABI decoding');
  }
}

function routePath(route: ProtocolRoute): Address[] {
  return [route.tokenIn, ...route.legs.map((leg) => leg.tokenOut)];
}

export class UniswapV2Adapter implements ProtocolAdapter {
  readonly manifest: ProtocolAdapterManifest;

  constructor(registry: Registry<DexContractEntry>, chainId: SupportedChainId) {
    this.manifest = loadVerifiedProtocolManifest({
      registry,
      chainId,
      protocol: 'uniswap',
      version: 'v2',
      supportedFeeTiers: [UNISWAP_V2_FEE],
      eventSignatures,
      requiredRoles: ['factory', 'router'],
    });
  }

  assertSupportedFeeTier(fee: number): void {
    if (!this.manifest.supportedFeeTiers.includes(fee)) {
      throw new UnsupportedFeeTierError(this.manifest.protocol, this.manifest.version, fee);
    }
  }

  discoverPool(log: ProtocolLog): NormalizedPool | null {
    if (log.topics[0]?.toLowerCase() !== eventTopics.poolCreated.toLowerCase()) return null;
    if (log.address.toLowerCase() !== this.manifest.factory.address.toLowerCase()) return null;
    assertEvent(log, eventTopics.poolCreated, 3);
    const token0 = indexedAddress(log.topics[1], 'token0');
    const token1 = indexedAddress(log.topics[2], 'token1');
    const [pair] = decodeData(() => decodeAbiParameters(factoryDataParameters, log.data));
    if (token0.toLowerCase() === token1.toLowerCase()) {
      throw new MalformedProtocolLogError('Pool tokens must differ');
    }
    return {
      protocol: this.manifest.protocol,
      version: this.manifest.version,
      factory: this.manifest.factory.address,
      address: getAddress(pair),
      token0,
      token1,
      fee: UNISWAP_V2_FEE,
      liquidity: 0n,
      state: { model: 'constant-product', reserve0: 0n, reserve1: 0n, totalSupply: 0n },
      provenance: getProvenance(log),
    };
  }

  async readPoolMetadata(
    client: ProtocolReadClient,
    poolAddress: Address,
    provenance: BlockProvenance,
  ): Promise<NormalizedPool> {
    await this.verifyRuntime(client, [this.manifest.factory]);
    return this.readPoolMetadataAfterVerification(client, poolAddress, provenance);
  }

  async readPoolState(
    client: ProtocolReadClient,
    poolAddress: Address,
    blockNumber?: bigint,
  ): Promise<NormalizedPoolState> {
    await this.verifyRuntime(client, [this.manifest.factory]);
    const [reservesValue, totalSupplyValue] = await Promise.all([
      client.readContract({
        address: poolAddress,
        abi: pairAbi,
        functionName: 'getReserves',
        blockNumber,
      }),
      client.readContract({
        address: poolAddress,
        abi: pairAbi,
        functionName: 'totalSupply',
        blockNumber,
      }),
    ]);
    const reserves = reservesResultSchema.parse(reservesValue);
    const totalSupply = z.bigint().nonnegative().parse(totalSupplyValue);
    return {
      model: 'constant-product',
      reserve0: reserves[0],
      reserve1: reserves[1],
      totalSupply,
    };
  }

  decodeSwap(log: ProtocolLog, pool: NormalizedPool): NormalizedSwap | null {
    if (log.topics[0]?.toLowerCase() !== eventTopics.swap.toLowerCase()) return null;
    this.assertPoolLog(log, pool);
    assertEvent(log, eventTopics.swap, 3);
    const sender = indexedAddress(log.topics[1], 'sender');
    const recipient = indexedAddress(log.topics[2], 'recipient');
    const [amount0In, amount1In, amount0Out, amount1Out] = decodeData(() =>
      decodeAbiParameters(swapDataParameters, log.data),
    );
    const token0ToToken1 =
      amount0In > 0n && amount1In === 0n && amount1Out > 0n && amount0Out === 0n;
    const token1ToToken0 =
      amount1In > 0n && amount0In === 0n && amount0Out > 0n && amount1Out === 0n;
    if (!token0ToToken1 && !token1ToToken0) {
      throw new MalformedProtocolLogError('Swap amounts do not define one direction');
    }
    return {
      kind: 'swap',
      protocol: this.manifest.protocol,
      version: this.manifest.version,
      poolAddress: pool.address,
      token0: pool.token0,
      token1: pool.token1,
      fee: pool.fee,
      direction: token0ToToken1 ? 'token0-to-token1' : 'token1-to-token0',
      amountIn: token0ToToken1 ? amount0In : amount1In,
      amountOut: token0ToToken1 ? amount1Out : amount0Out,
      sender,
      recipient,
      provenance: getProvenance(log),
    };
  }

  decodeLiquidityAddition(
    log: ProtocolLog,
    pool: NormalizedPool,
  ): NormalizedLiquidityChange | null {
    if (log.topics[0]?.toLowerCase() !== eventTopics.liquidityAdded.toLowerCase()) return null;
    this.assertPoolLog(log, pool);
    assertEvent(log, eventTopics.liquidityAdded, 2);
    const sender = indexedAddress(log.topics[1], 'sender');
    const [amount0, amount1] = decodeData(() =>
      decodeAbiParameters(liquidityDataParameters, log.data),
    );
    return this.liquidityChange('liquidity-addition', log, pool, sender, null, amount0, amount1);
  }

  decodeLiquidityRemoval(log: ProtocolLog, pool: NormalizedPool): NormalizedLiquidityChange | null {
    if (log.topics[0]?.toLowerCase() !== eventTopics.liquidityRemoved.toLowerCase()) return null;
    this.assertPoolLog(log, pool);
    assertEvent(log, eventTopics.liquidityRemoved, 3);
    const sender = indexedAddress(log.topics[1], 'sender');
    const recipient = indexedAddress(log.topics[2], 'recipient');
    const [amount0, amount1] = decodeData(() =>
      decodeAbiParameters(liquidityDataParameters, log.data),
    );
    return this.liquidityChange(
      'liquidity-removal',
      log,
      pool,
      sender,
      recipient,
      amount0,
      amount1,
    );
  }

  async quote(client: ProtocolReadClient, request: QuoteRequest): Promise<ProtocolQuote> {
    const router = this.requireRouter();
    this.validateRoute(request.route);
    if (request.amountIn <= 0n) throw new Error('Quote amount must be greater than zero');
    await this.verifyRuntime(client, [this.manifest.factory, router]);
    await this.validateRoutePools(client, request.route);
    const amountsValue = await client.readContract({
      address: router.address,
      abi: routerAbi,
      functionName: 'getAmountsOut',
      args: [request.amountIn, routePath(request.route)],
    });
    const amounts = quoteResultSchema.parse(amountsValue);
    if (amounts.length !== request.route.legs.length + 1) {
      throw new Error('Router quote returned an unexpected path length');
    }
    const amountOut = amounts.at(-1);
    if (amountOut === undefined) throw new Error('Router quote returned no output amount');
    return {
      route: request.route,
      amountIn: request.amountIn,
      amountOut,
      blockNumber: await client.getBlockNumber(),
      provider: `${this.manifest.protocol}-${this.manifest.version}`,
    };
  }

  async prepareTransaction(
    client: ProtocolExecutionClient,
    request: TransactionPreparationRequest,
  ): Promise<PreparedProtocolTransaction> {
    const router = this.requireRouter();
    this.validateRoute(request.route);
    if (request.amountIn <= 0n || request.minimumAmountOut <= 0n) {
      throw new Error('Swap amounts must be greater than zero');
    }
    if (request.deadline <= (await client.getBlockTimestamp())) {
      throw new Error('Swap deadline must be in the future');
    }
    await this.verifyRuntime(client, [this.manifest.factory, router]);
    await this.validateRoutePools(client, request.route);
    const data = encodeFunctionData({
      abi: routerAbi,
      functionName: 'swapExactTokensForTokens',
      args: [
        request.amountIn,
        request.minimumAmountOut,
        routePath(request.route),
        request.recipient,
        request.deadline,
      ],
    });
    const simulation = await client.simulateTransaction({
      account: request.sender,
      to: router.address,
      data,
      value: 0n,
    });
    if (!simulation.success) {
      throw new Error(simulation.error ?? 'Swap simulation failed');
    }
    return {
      chainId: this.manifest.chainId,
      to: router.address,
      data,
      value: 0n,
      deadline: request.deadline,
      intent: {
        protocol: this.manifest.protocol,
        version: this.manifest.version,
        tokenIn: request.route.tokenIn,
        tokenOut: request.route.tokenOut,
        amountIn: request.amountIn,
        minimumAmountOut: request.minimumAmountOut,
        recipient: request.recipient,
      },
    };
  }

  calculatePriceImpact(request: PriceImpactRequest): PriceImpactResult {
    if (
      request.amountIn <= 0n ||
      request.amountOut <= 0n ||
      request.reserveIn <= 0n ||
      request.reserveOut <= 0n
    ) {
      throw new Error('Price impact inputs must be greater than zero');
    }
    const executionToSpotBps =
      (request.amountOut * request.reserveIn * 10_000n) / (request.amountIn * request.reserveOut);
    return { impactBps: executionToSpotBps >= 10_000n ? 0n : 10_000n - executionToSpotBps };
  }

  private async readPoolMetadataAfterVerification(
    client: ProtocolReadClient,
    poolAddress: Address,
    provenance: BlockProvenance,
  ): Promise<NormalizedPool> {
    const [token0Value, token1Value, factoryValue] = await Promise.all([
      client.readContract({ address: poolAddress, abi: pairAbi, functionName: 'token0' }),
      client.readContract({ address: poolAddress, abi: pairAbi, functionName: 'token1' }),
      client.readContract({ address: poolAddress, abi: pairAbi, functionName: 'factory' }),
    ]);
    const token0 = addressResultSchema.parse(token0Value);
    const token1 = addressResultSchema.parse(token1Value);
    const factory = addressResultSchema.parse(factoryValue);
    if (factory.toLowerCase() !== this.manifest.factory.address.toLowerCase()) {
      throw new UnverifiedProtocolContractError(
        'Pool factory does not match the verified registry',
      );
    }
    await this.assertCanonicalPool(client, poolAddress, token0, token1);
    const state = await this.readPoolState(client, poolAddress, provenance.blockNumber);
    return {
      protocol: this.manifest.protocol,
      version: this.manifest.version,
      factory,
      address: poolAddress,
      token0,
      token1,
      fee: UNISWAP_V2_FEE,
      liquidity: state.model === 'constant-product' ? state.totalSupply : state.activeLiquidity,
      state,
      provenance,
    };
  }

  private liquidityChange(
    kind: NormalizedLiquidityChange['kind'],
    log: ProtocolLog,
    pool: NormalizedPool,
    sender: Address,
    recipient: Address | null,
    amount0: bigint,
    amount1: bigint,
  ): NormalizedLiquidityChange {
    return {
      kind,
      protocol: this.manifest.protocol,
      version: this.manifest.version,
      poolAddress: pool.address,
      token0: pool.token0,
      token1: pool.token1,
      amount0,
      amount1,
      sender,
      recipient,
      provenance: getProvenance(log),
    };
  }

  private assertPoolLog(log: ProtocolLog, pool: NormalizedPool): void {
    if (log.address.toLowerCase() !== pool.address.toLowerCase()) {
      throw new MalformedProtocolLogError('Pool event address does not match registered pool');
    }
    this.assertSupportedFeeTier(pool.fee);
  }

  private validateRoute(route: ProtocolRoute): void {
    if (route.chainId !== this.manifest.chainId || route.legs.length === 0) {
      throw new Error('Route chain or leg count is invalid');
    }
    let expectedToken = route.tokenIn;
    for (const leg of route.legs) {
      if (
        leg.protocol !== this.manifest.protocol ||
        leg.version !== this.manifest.version ||
        leg.tokenIn.toLowerCase() !== expectedToken.toLowerCase()
      ) {
        throw new Error('Route leg does not match this adapter');
      }
      this.assertSupportedFeeTier(leg.fee);
      expectedToken = leg.tokenOut;
    }
    if (expectedToken.toLowerCase() !== route.tokenOut.toLowerCase()) {
      throw new Error('Route output token does not match its final leg');
    }
  }

  private async validateRoutePools(
    client: ProtocolReadClient,
    route: ProtocolRoute,
  ): Promise<void> {
    for (const leg of route.legs) {
      const [token0Value, token1Value, factoryValue] = await Promise.all([
        client.readContract({ address: leg.poolAddress, abi: pairAbi, functionName: 'token0' }),
        client.readContract({ address: leg.poolAddress, abi: pairAbi, functionName: 'token1' }),
        client.readContract({ address: leg.poolAddress, abi: pairAbi, functionName: 'factory' }),
      ]);
      const token0 = addressResultSchema.parse(token0Value);
      const token1 = addressResultSchema.parse(token1Value);
      const factory = addressResultSchema.parse(factoryValue);
      const tokensMatch =
        (token0.toLowerCase() === leg.tokenIn.toLowerCase() &&
          token1.toLowerCase() === leg.tokenOut.toLowerCase()) ||
        (token1.toLowerCase() === leg.tokenIn.toLowerCase() &&
          token0.toLowerCase() === leg.tokenOut.toLowerCase());
      if (!tokensMatch || factory.toLowerCase() !== this.manifest.factory.address.toLowerCase()) {
        throw new UnverifiedProtocolContractError(
          'Route pool does not match verified factory and token metadata',
        );
      }
      await this.assertCanonicalPool(client, leg.poolAddress, token0, token1);
    }
  }

  private async assertCanonicalPool(
    client: ProtocolReadClient,
    poolAddress: Address,
    token0: Address,
    token1: Address,
  ): Promise<void> {
    const pairValue = await client.readContract({
      address: this.manifest.factory.address,
      abi: factoryAbi,
      functionName: 'getPair',
      args: [token0, token1],
    });
    const canonicalPair = addressResultSchema.parse(pairValue);
    if (canonicalPair.toLowerCase() !== poolAddress.toLowerCase()) {
      throw new UnverifiedProtocolContractError(
        'Pool address does not match the verified factory mapping',
      );
    }
  }

  private async verifyRuntime(
    client: ProtocolReadClient,
    contracts: readonly VerifiedProtocolContract[],
  ): Promise<void> {
    const chainId = await client.getChainId();
    if (chainId !== this.manifest.chainId) {
      throw new UnverifiedProtocolContractError(
        `Protocol runtime chain ID ${chainId} does not match ${this.manifest.chainId}`,
      );
    }
    for (const contract of contracts) {
      const bytecode = await client.getBytecode(contract.address);
      if (
        bytecode === undefined ||
        bytecode === '0x' ||
        keccak256(bytecode) !== contract.runtimeBytecodeHash
      ) {
        throw new UnverifiedProtocolContractError(
          `${contract.role} runtime bytecode does not match the verified registry`,
        );
      }
    }
  }

  private requireRouter(): VerifiedProtocolContract {
    const router = this.manifest.router;
    if (router === null) {
      throw new UnverifiedProtocolContractError('Protocol adapter lacks a verified router');
    }
    return router;
  }
}
