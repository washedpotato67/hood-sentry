import { generateId } from '@hood-sentry/shared';
import {
  type Address,
  type Hash,
  type Hex,
  decodeAbiParameters,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  parseAbi,
  stringToHex,
  toEventSelector,
  toFunctionSelector,
} from 'viem';
import { z } from 'zod';
import {
  MalformedProtocolLogError,
  QuoteValidationError,
  TransactionPreparationError,
  UnknownPoolError,
  UnsupportedFeeTierError,
  UnverifiedProtocolContractError,
} from './errors.js';
import { getProvenance, parseRawChainLog } from './log.js';
import { getProtocolContract } from './registry.js';
import { FEE_DENOMINATOR } from './types.js';
import type {
  DecodedProtocolEvent,
  DexAdapter,
  NormalizedLiquidityEvent,
  NormalizedPool,
  NormalizedPoolState,
  NormalizedQuote,
  NormalizedRouteStep,
  NormalizedSwap,
  PreparedProtocolTransaction,
  PriceImpactRequest,
  PriceImpactResult,
  ProtocolContractConfig,
  ProtocolDefinition,
  ProtocolEventDefinition,
  ProtocolExecutionClient,
  ProtocolValidationResult,
  QuoteRequest,
  RawChainLog,
  TransactionFeaturePolicy,
} from './types.js';
import type { ProtocolValidationService } from './validation.js';

export const UNISWAP_V2_FEE_TIER = 3_000n;
export const UNISWAP_V2_SWAP_SELECTOR = toFunctionSelector(
  'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)',
);

const signatures = {
  poolCreated: 'PairCreated(address,address,address,uint256)',
  swap: 'Swap(address,uint256,uint256,uint256,uint256,address)',
  liquidityAdded: 'Mint(address,uint256,uint256)',
  liquidityRemoved: 'Burn(address,uint256,uint256,address)',
} as const;

const topics = {
  poolCreated: toEventSelector(signatures.poolCreated),
  swap: toEventSelector(signatures.swap),
  liquidityAdded: toEventSelector(signatures.liquidityAdded),
  liquidityRemoved: toEventSelector(signatures.liquidityRemoved),
} as const;

const eventDefinitions: readonly ProtocolEventDefinition[] = [
  {
    kind: 'poolCreated',
    contractRole: 'factory',
    signature: signatures.poolCreated,
    topic0: topics.poolCreated,
  },
  { kind: 'swap', contractRole: 'pool', signature: signatures.swap, topic0: topics.swap },
  {
    kind: 'liquidityAdded',
    contractRole: 'pool',
    signature: signatures.liquidityAdded,
    topic0: topics.liquidityAdded,
  },
  {
    kind: 'liquidityRemoved',
    contractRole: 'pool',
    signature: signatures.liquidityRemoved,
    topic0: topics.liquidityRemoved,
  },
];

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

const pairCreatedData = [
  { name: 'pair', type: 'address' },
  { name: 'pairCount', type: 'uint256' },
] as const;
const swapData = [
  { name: 'amount0In', type: 'uint256' },
  { name: 'amount1In', type: 'uint256' },
  { name: 'amount0Out', type: 'uint256' },
  { name: 'amount1Out', type: 'uint256' },
] as const;
const liquidityData = [
  { name: 'amount0', type: 'uint256' },
  { name: 'amount1', type: 'uint256' },
] as const;

const addressSchema = z
  .string()
  .refine(isAddress)
  .transform((address) => getAddress(address));
const reservesSchema = z.tuple([
  z.bigint().nonnegative(),
  z.bigint().nonnegative(),
  z.union([z.number().int().nonnegative(), z.bigint().nonnegative()]),
]);
const amountsSchema = z.array(z.bigint().nonnegative()).min(2);

export interface UniswapV2AdapterOptions {
  now?: () => Date;
  defaultQuoteTtlSeconds?: number;
  maximumQuoteTtlSeconds?: number;
}

export class UniswapV2Adapter implements DexAdapter {
  readonly protocolKey: string;
  readonly protocolName: string;
  readonly version: string;
  readonly chainId: number;
  readonly kind = 'dex' as const;

  private readonly factory: ProtocolContractConfig;
  private readonly router: ProtocolContractConfig;
  private readonly pools = new Map<string, NormalizedPool>();
  private readonly issuedQuotes = new Map<string, Hash>();
  private readonly now: () => Date;
  private readonly defaultQuoteTtlSeconds: number;
  private readonly maximumQuoteTtlSeconds: number;

  constructor(
    private readonly definition: ProtocolDefinition,
    private readonly client: ProtocolExecutionClient,
    private readonly validation: ProtocolValidationService,
    private readonly featurePolicy: TransactionFeaturePolicy,
    options: UniswapV2AdapterOptions = {},
  ) {
    if (definition.kind !== 'dex') throw new Error('Uniswap v2 requires a DEX definition');
    this.protocolKey = definition.protocolKey;
    this.protocolName = definition.protocolName;
    this.version = definition.protocolVersion;
    this.chainId = definition.chainId;
    this.factory = this.requireContract('factory');
    this.router = this.requireContract('router');
    this.now = options.now ?? (() => new Date());
    this.defaultQuoteTtlSeconds = options.defaultQuoteTtlSeconds ?? 30;
    this.maximumQuoteTtlSeconds = options.maximumQuoteTtlSeconds ?? 120;
  }

  validateConfiguration(): Promise<ProtocolValidationResult> {
    return this.validation.getValidation(this.protocolKey, this.version, this.chainId);
  }

  getEventDefinitions(): readonly ProtocolEventDefinition[] {
    return eventDefinitions;
  }

  supportsAddress(address: Address): boolean {
    const key = address.toLowerCase();
    return (
      this.definition.contracts.some((contract) => contract.address.toLowerCase() === key) ||
      this.pools.has(key)
    );
  }

  registerPool(pool: NormalizedPool): void {
    if (
      pool.chainId !== this.chainId ||
      pool.protocolKey !== this.protocolKey ||
      pool.protocolVersion !== this.version ||
      pool.factoryAddress.toLowerCase() !== this.factory.address.toLowerCase()
    ) {
      throw new UnverifiedProtocolContractError('Pool identity does not match this adapter');
    }
    this.assertFeeTier(pool.feeTier);
    this.pools.set(pool.poolAddress.toLowerCase(), pool);
  }

  async decodeLog(value: RawChainLog): Promise<DecodedProtocolEvent | null> {
    const log = parseRawChainLog(value);
    if (log.chainId !== this.chainId || !this.supportsAddress(log.address)) return null;
    const topic0 = log.topics[0]?.toLowerCase();
    let kind: DecodedProtocolEvent['kind'] | null = null;
    if (
      log.address.toLowerCase() === this.factory.address.toLowerCase() &&
      topic0 === topics.poolCreated.toLowerCase()
    ) {
      kind = 'poolCreated';
    } else if (this.pools.has(log.address.toLowerCase())) {
      if (topic0 === topics.swap.toLowerCase()) kind = 'swap';
      if (topic0 === topics.liquidityAdded.toLowerCase()) kind = 'liquidityAdded';
      if (topic0 === topics.liquidityRemoved.toLowerCase()) kind = 'liquidityRemoved';
    }
    if (kind === null) return null;
    return {
      protocolKey: this.protocolKey,
      protocolName: this.protocolName,
      protocolVersion: this.version,
      kind,
      emitterAddress: log.address,
      provenance: getProvenance(log),
      fields: this.decodeFields(kind, log),
    };
  }

  async discoverPool(event: DecodedProtocolEvent): Promise<NormalizedPool | null> {
    if (event.kind !== 'poolCreated') return null;
    await this.validation.assertActive(this.protocolKey, this.version, this.chainId);
    if (event.emitterAddress.toLowerCase() !== this.factory.address.toLowerCase()) {
      throw new UnverifiedProtocolContractError(
        'Pool event did not originate from the verified factory',
      );
    }
    const poolAddress = addressSchema.parse(event.fields.poolAddress);
    const eventToken0 = addressSchema.parse(event.fields.token0Address);
    const eventToken1 = addressSchema.parse(event.fields.token1Address);
    const bytecode = await this.client.getBytecode(poolAddress, event.provenance.blockNumber);
    if (bytecode === undefined || bytecode === '0x') {
      throw new UnverifiedProtocolContractError('Discovered pool has no runtime bytecode');
    }
    const [token0Value, token1Value, factoryValue] = await Promise.all([
      this.client.readContract({
        address: poolAddress,
        abi: pairAbi,
        functionName: 'token0',
        blockNumber: event.provenance.blockNumber,
      }),
      this.client.readContract({
        address: poolAddress,
        abi: pairAbi,
        functionName: 'token1',
        blockNumber: event.provenance.blockNumber,
      }),
      this.client.readContract({
        address: poolAddress,
        abi: pairAbi,
        functionName: 'factory',
        blockNumber: event.provenance.blockNumber,
      }),
    ]);
    const token0Address = addressSchema.parse(token0Value);
    const token1Address = addressSchema.parse(token1Value);
    const factoryAddress = addressSchema.parse(factoryValue);
    if (
      token0Address.toLowerCase() !== eventToken0.toLowerCase() ||
      token1Address.toLowerCase() !== eventToken1.toLowerCase()
    ) {
      throw new UnverifiedProtocolContractError('Pool token state differs from the factory event');
    }
    await this.assertCanonicalPair(
      poolAddress,
      token0Address,
      token1Address,
      event.provenance.blockNumber,
    );
    if (factoryAddress.toLowerCase() !== this.factory.address.toLowerCase()) {
      throw new UnverifiedProtocolContractError('Pool reports an unverified factory');
    }
    const pool: NormalizedPool = {
      chainId: this.chainId,
      protocolKey: this.protocolKey,
      protocolVersion: this.version,
      poolAddress,
      factoryAddress,
      token0Address,
      token1Address,
      feeTier: UNISWAP_V2_FEE_TIER,
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

  async readPoolState(poolAddress: Address, blockNumber?: bigint): Promise<NormalizedPoolState> {
    await this.validation.assertActive(this.protocolKey, this.version, this.chainId);
    this.requirePool(poolAddress);
    const [reservesValue, totalSupplyValue] = await Promise.all([
      this.client.readContract({
        address: poolAddress,
        abi: pairAbi,
        functionName: 'getReserves',
        blockNumber,
      }),
      this.client.readContract({
        address: poolAddress,
        abi: pairAbi,
        functionName: 'totalSupply',
        blockNumber,
      }),
    ]);
    const reserves = reservesSchema.parse(reservesValue);
    return {
      poolType: 'constantProduct',
      reserve0Raw: reserves[0],
      reserve1Raw: reserves[1],
      lpTotalSupplyRaw: z.bigint().nonnegative().parse(totalSupplyValue),
    };
  }

  async decodeSwap(value: RawChainLog): Promise<NormalizedSwap | null> {
    const log = parseRawChainLog(value);
    if (log.topics[0]?.toLowerCase() !== topics.swap.toLowerCase()) return null;
    const pool = this.requirePool(log.address);
    this.assertTopics(log, 3);
    const [amount0In, amount1In, amount0Out, amount1Out] = this.decode(() =>
      decodeAbiParameters(swapData, log.data),
    );
    const zeroToOne = amount0In > 0n && amount1In === 0n && amount0Out === 0n && amount1Out > 0n;
    const oneToZero = amount1In > 0n && amount0In === 0n && amount1Out === 0n && amount0Out > 0n;
    if (!zeroToOne && !oneToZero) {
      throw new MalformedProtocolLogError('Swap amounts do not define one direction');
    }
    return {
      chainId: this.chainId,
      protocolKey: this.protocolKey,
      protocolVersion: this.version,
      poolAddress: pool.poolAddress,
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      logIndex: log.logIndex,
      senderAddress: this.indexedAddress(log.topics[1], 'sender'),
      recipientAddress: this.indexedAddress(log.topics[2], 'recipient'),
      tokenInAddress: zeroToOne ? pool.token0Address : pool.token1Address,
      tokenOutAddress: zeroToOne ? pool.token1Address : pool.token0Address,
      amountInRaw: zeroToOne ? amount0In : amount1In,
      amountOutRaw: zeroToOne ? amount1Out : amount0Out,
      canonical: log.canonical && !log.removed,
    };
  }

  async decodeLiquidityEvent(value: RawChainLog): Promise<NormalizedLiquidityEvent | null> {
    const log = parseRawChainLog(value);
    const topic0 = log.topics[0]?.toLowerCase();
    if (
      topic0 !== topics.liquidityAdded.toLowerCase() &&
      topic0 !== topics.liquidityRemoved.toLowerCase()
    ) {
      return null;
    }
    const pool = this.requirePool(log.address);
    const removal = topic0 === topics.liquidityRemoved.toLowerCase();
    this.assertTopics(log, removal ? 3 : 2);
    const [amount0Raw, amount1Raw] = this.decode(() =>
      decodeAbiParameters(liquidityData, log.data),
    );
    return {
      chainId: this.chainId,
      protocolKey: this.protocolKey,
      protocolVersion: this.version,
      eventType: removal ? 'liquidityRemoved' : 'liquidityAdded',
      poolAddress: pool.poolAddress,
      providerAddress: this.indexedAddress(log.topics[1], 'provider'),
      recipientAddress: removal ? this.indexedAddress(log.topics[2], 'recipient') : undefined,
      token0Address: pool.token0Address,
      token1Address: pool.token1Address,
      amount0Raw,
      amount1Raw,
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      transactionHash: log.transactionHash,
      logIndex: log.logIndex,
      canonical: log.canonical && !log.removed,
    };
  }

  async getQuote(request: QuoteRequest): Promise<NormalizedQuote> {
    await this.validation.assertActive(this.protocolKey, this.version, this.chainId);
    this.validateQuoteRequest(request);
    await this.validateRoute(request.route);
    const path = this.routePath(request.route);
    const amountsValue = await this.client.readContract({
      address: this.router.address,
      abi: routerAbi,
      functionName: 'getAmountsOut',
      args: [request.amountInRaw, path],
    });
    const amounts = amountsSchema.parse(amountsValue);
    if (amounts.length !== request.route.length + 1) {
      throw new QuoteValidationError('Router returned an unexpected route length');
    }
    const expectedAmountOutRaw = amounts.at(-1);
    if (expectedAmountOutRaw === undefined || expectedAmountOutRaw < request.minimumAmountOutRaw) {
      throw new QuoteValidationError('Expected output is below minimum received');
    }
    const sourceBlockNumber = await this.client.getBlockNumber();
    const createdAt = this.now();
    const ttlSeconds = Math.min(
      request.ttlSeconds ?? this.defaultQuoteTtlSeconds,
      this.maximumQuoteTtlSeconds,
    );
    const warnings = [];
    const priceImpactBps = await this.quotePriceImpact(
      request.route,
      request.amountInRaw,
      expectedAmountOutRaw,
    );
    if (request.route.length > 1) {
      warnings.push({
        code: 'MULTI_HOP_PRICE_IMPACT_UNAVAILABLE',
        message: 'Aggregate multi-hop price impact is unavailable.',
        severity: 'warning' as const,
      });
    }
    const quote: NormalizedQuote = {
      quoteId: generateId('quote'),
      chainId: this.chainId,
      protocolKey: this.protocolKey,
      protocolVersion: this.version,
      inputTokenAddress: request.inputTokenAddress,
      outputTokenAddress: request.outputTokenAddress,
      amountInRaw: request.amountInRaw,
      expectedAmountOutRaw,
      minimumAmountOutRaw: request.minimumAmountOutRaw,
      priceImpactBps,
      protocolFeeRaw: (request.amountInRaw * UNISWAP_V2_FEE_TIER) / FEE_DENOMINATOR,
      route: [...request.route],
      spenderAddress: this.router.address,
      transactionTarget: this.router.address,
      transactionSelector: UNISWAP_V2_SWAP_SELECTOR,
      sourceBlockNumber,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + ttlSeconds * 1000).toISOString(),
      warnings,
    };
    this.issuedQuotes.set(quote.quoteId, this.quoteFingerprint(quote));
    return quote;
  }

  async prepareSwapTransaction(
    quote: NormalizedQuote,
    userAddress: Address,
  ): Promise<PreparedProtocolTransaction> {
    await this.validation.assertActive(this.protocolKey, this.version, this.chainId);
    await this.featurePolicy.assertTradingEnabled(this.chainId);
    const chainId = await this.client.getChainId();
    if (chainId !== this.chainId) {
      throw new TransactionPreparationError(`RPC chain ${chainId} does not match ${this.chainId}`);
    }
    this.validatePreparedQuote(quote);
    await this.validateRoute(quote.route);
    const deadline = BigInt(Math.floor(new Date(quote.expiresAt).getTime() / 1000));
    const currentTimestamp = await this.client.getBlockTimestamp();
    if (deadline <= currentTimestamp)
      throw new TransactionPreparationError('Quote deadline expired');
    const data = encodeFunctionData({
      abi: routerAbi,
      functionName: 'swapExactTokensForTokens',
      args: [
        quote.amountInRaw,
        quote.minimumAmountOutRaw,
        this.routePath(quote.route),
        userAddress,
        deadline,
      ],
    });
    if (data.slice(0, 10).toLowerCase() !== UNISWAP_V2_SWAP_SELECTOR.toLowerCase()) {
      throw new TransactionPreparationError('Prepared calldata selector is not allowlisted');
    }
    const simulation = await this.client.simulateTransaction({
      account: userAddress,
      to: this.router.address,
      data,
      value: 0n,
    });
    if (!simulation.success) {
      throw new TransactionPreparationError(simulation.error ?? 'Swap simulation failed');
    }
    this.validateSimulationReturn(simulation.returnValue, quote);
    return {
      chainId: this.chainId,
      protocolKey: this.protocolKey,
      protocolVersion: this.version,
      to: this.router.address,
      data,
      value: 0n,
      spenderAddress: this.router.address,
      functionSelector: UNISWAP_V2_SWAP_SELECTOR,
      deadline,
      quoteId: quote.quoteId,
      simulation,
      warnings: quote.warnings,
      expectedStateChanges: [
        {
          assetAddress: quote.inputTokenAddress,
          accountAddress: userAddress,
          direction: 'decrease',
          amountRaw: quote.amountInRaw,
        },
        {
          assetAddress: quote.outputTokenAddress,
          accountAddress: userAddress,
          direction: 'increase',
          amountRaw: quote.expectedAmountOutRaw,
        },
      ],
      intent: {
        inputTokenAddress: quote.inputTokenAddress,
        outputTokenAddress: quote.outputTokenAddress,
        amountInRaw: quote.amountInRaw,
        minimumAmountOutRaw: quote.minimumAmountOutRaw,
        recipientAddress: userAddress,
        route: quote.route,
      },
    };
  }

  calculatePriceImpact(request: PriceImpactRequest): PriceImpactResult {
    if (
      request.amountInRaw <= 0n ||
      request.amountOutRaw <= 0n ||
      request.reserveInRaw <= 0n ||
      request.reserveOutRaw <= 0n
    ) {
      throw new QuoteValidationError('Price impact inputs must be positive integers');
    }
    const executionToSpotBps =
      (request.amountOutRaw * request.reserveInRaw * 10_000n) /
      (request.amountInRaw * request.reserveOutRaw);
    return {
      priceImpactBps: executionToSpotBps >= 10_000n ? 0n : 10_000n - executionToSpotBps,
    };
  }

  private decodeFields(
    kind: DecodedProtocolEvent['kind'],
    log: RawChainLog,
  ): DecodedProtocolEvent['fields'] {
    if (kind === 'poolCreated') {
      this.assertTopics(log, 3);
      const [poolAddress] = this.decode(() => decodeAbiParameters(pairCreatedData, log.data));
      return {
        token0Address: this.indexedAddress(log.topics[1], 'token0'),
        token1Address: this.indexedAddress(log.topics[2], 'token1'),
        poolAddress: getAddress(poolAddress),
      };
    }
    if (kind === 'swap') {
      const [amount0In, amount1In, amount0Out, amount1Out] = this.decode(() =>
        decodeAbiParameters(swapData, log.data),
      );
      return { amount0In, amount1In, amount0Out, amount1Out };
    }
    const [amount0, amount1] = this.decode(() => decodeAbiParameters(liquidityData, log.data));
    return { amount0, amount1 };
  }

  private async validateRoute(route: readonly NormalizedRouteStep[]): Promise<void> {
    let expectedInput: Address | null = null;
    for (const step of route) {
      const pool = this.requirePool(step.poolAddress);
      this.assertFeeTier(step.feeTier);
      if (step.protocolKey !== this.protocolKey || step.protocolVersion !== this.version) {
        throw new QuoteValidationError('Route contains another protocol');
      }
      if (
        expectedInput !== null &&
        step.inputTokenAddress.toLowerCase() !== expectedInput.toLowerCase()
      ) {
        throw new QuoteValidationError('Route token continuity is invalid');
      }
      const tokenPairMatches =
        (pool.token0Address.toLowerCase() === step.inputTokenAddress.toLowerCase() &&
          pool.token1Address.toLowerCase() === step.outputTokenAddress.toLowerCase()) ||
        (pool.token1Address.toLowerCase() === step.inputTokenAddress.toLowerCase() &&
          pool.token0Address.toLowerCase() === step.outputTokenAddress.toLowerCase());
      if (!tokenPairMatches)
        throw new QuoteValidationError('Route token pair does not match the pool');
      await this.assertCanonicalPair(pool.poolAddress, pool.token0Address, pool.token1Address);
      expectedInput = step.outputTokenAddress;
    }
  }

  private validateQuoteRequest(request: QuoteRequest): void {
    if (
      request.chainId !== this.chainId ||
      request.protocolKey !== this.protocolKey ||
      request.route.length === 0
    ) {
      throw new QuoteValidationError('Quote protocol, chain, or route is invalid');
    }
    if (request.amountInRaw <= 0n || request.minimumAmountOutRaw <= 0n) {
      throw new QuoteValidationError('Quote amounts must be positive integers');
    }
    if (
      request.route[0]?.inputTokenAddress.toLowerCase() !==
        request.inputTokenAddress.toLowerCase() ||
      request.route.at(-1)?.outputTokenAddress.toLowerCase() !==
        request.outputTokenAddress.toLowerCase()
    ) {
      throw new QuoteValidationError('Quote route endpoints are invalid');
    }
    if (request.ttlSeconds !== undefined && request.ttlSeconds <= 0) {
      throw new QuoteValidationError('Quote TTL must be positive');
    }
  }

  private validatePreparedQuote(quote: NormalizedQuote): void {
    if (quote.chainId !== this.chainId || quote.protocolKey !== this.protocolKey) {
      throw new TransactionPreparationError('Quote protocol or chain is invalid');
    }
    if (quote.transactionTarget.toLowerCase() !== this.router.address.toLowerCase()) {
      throw new TransactionPreparationError('Quote transaction target is not allowlisted');
    }
    if (quote.spenderAddress?.toLowerCase() !== this.router.address.toLowerCase()) {
      throw new TransactionPreparationError('Quote spender is not allowlisted');
    }
    if (quote.transactionSelector.toLowerCase() !== UNISWAP_V2_SWAP_SELECTOR.toLowerCase()) {
      throw new TransactionPreparationError('Quote transaction selector is not allowlisted');
    }
    if (new Date(quote.expiresAt).getTime() <= this.now().getTime()) {
      throw new TransactionPreparationError('Quote has expired');
    }
    if (quote.minimumAmountOutRaw <= 0n || quote.minimumAmountOutRaw > quote.expectedAmountOutRaw) {
      throw new TransactionPreparationError('Quote minimum output is invalid');
    }
    const issuedFingerprint = this.issuedQuotes.get(quote.quoteId);
    if (issuedFingerprint === undefined || issuedFingerprint !== this.quoteFingerprint(quote)) {
      throw new TransactionPreparationError('Quote does not match a server-issued route');
    }
  }

  private validateSimulationReturn(returnValue: Hex, quote: NormalizedQuote): void {
    try {
      const decoded = decodeFunctionResult({
        abi: routerAbi,
        functionName: 'swapExactTokensForTokens',
        data: returnValue,
      });
      const amounts = amountsSchema.parse(decoded);
      const output = amounts.at(-1);
      if (output === undefined || output < quote.minimumAmountOutRaw) {
        throw new Error('Simulation output is below minimum received');
      }
    } catch (error) {
      throw new TransactionPreparationError(
        `Simulation result failed local decoding: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async quotePriceImpact(
    route: readonly NormalizedRouteStep[],
    amountInRaw: bigint,
    amountOutRaw: bigint,
  ): Promise<bigint | undefined> {
    if (route.length !== 1) return undefined;
    const step = route[0];
    if (step === undefined) return undefined;
    const pool = this.requirePool(step.poolAddress);
    const state = await this.readPoolState(pool.poolAddress);
    if (state.poolType !== 'constantProduct') return undefined;
    const zeroToOne = pool.token0Address.toLowerCase() === step.inputTokenAddress.toLowerCase();
    return this.calculatePriceImpact({
      amountInRaw,
      amountOutRaw,
      reserveInRaw: zeroToOne ? state.reserve0Raw : state.reserve1Raw,
      reserveOutRaw: zeroToOne ? state.reserve1Raw : state.reserve0Raw,
    }).priceImpactBps;
  }

  private async assertCanonicalPair(
    poolAddress: Address,
    token0Address: Address,
    token1Address: Address,
    blockNumber?: bigint,
  ): Promise<void> {
    const pairValue = await this.client.readContract({
      address: this.factory.address,
      abi: factoryAbi,
      functionName: 'getPair',
      args: [token0Address, token1Address],
      blockNumber,
    });
    if (addressSchema.parse(pairValue).toLowerCase() !== poolAddress.toLowerCase()) {
      throw new UnverifiedProtocolContractError('Pool is absent from the verified factory mapping');
    }
  }

  private requirePool(address: Address): NormalizedPool {
    const pool = this.pools.get(address.toLowerCase());
    if (pool === undefined) throw new UnknownPoolError(address);
    return pool;
  }

  private requireContract(role: ProtocolContractConfig['contractRole']): ProtocolContractConfig {
    const contract = getProtocolContract(this.definition, role);
    if (contract === null || !contract.enabled) {
      throw new UnverifiedProtocolContractError(`Uniswap v2 lacks an enabled ${role}`);
    }
    return contract;
  }

  private assertFeeTier(feeTier: bigint | undefined): void {
    if (feeTier !== UNISWAP_V2_FEE_TIER) {
      throw new UnsupportedFeeTierError(this.protocolKey, this.version, feeTier ?? -1n);
    }
  }

  private assertTopics(log: RawChainLog, count: number): void {
    if (log.topics.length !== count) {
      throw new MalformedProtocolLogError('Protocol event topic count is invalid');
    }
  }

  private indexedAddress(topic: Hex | undefined, name: string): Address {
    if (topic === undefined || topic.length !== 66) {
      throw new MalformedProtocolLogError(`Missing indexed ${name} address`);
    }
    return getAddress(`0x${topic.slice(-40)}`);
  }

  private decode<T>(operation: () => T): T {
    try {
      return operation();
    } catch {
      throw new MalformedProtocolLogError('Protocol event data failed ABI decoding');
    }
  }

  private routePath(route: readonly NormalizedRouteStep[]): Address[] {
    const first = route[0];
    if (first === undefined) throw new QuoteValidationError('Route is empty');
    return [first.inputTokenAddress, ...route.map((step) => step.outputTokenAddress)];
  }

  private quoteFingerprint(quote: NormalizedQuote): Hash {
    const route = quote.route
      .map(
        (step) =>
          `${step.protocolKey}:${step.protocolVersion}:${step.poolAddress}:${step.inputTokenAddress}:${step.outputTokenAddress}:${step.feeTier?.toString() ?? ''}`,
      )
      .join('>');
    return keccak256(
      stringToHex(
        [
          quote.quoteId,
          quote.chainId.toString(),
          quote.protocolKey,
          quote.protocolVersion,
          quote.inputTokenAddress,
          quote.outputTokenAddress,
          quote.amountInRaw.toString(),
          quote.expectedAmountOutRaw.toString(),
          quote.minimumAmountOutRaw.toString(),
          quote.spenderAddress ?? '',
          quote.transactionTarget,
          quote.transactionSelector,
          quote.sourceBlockNumber.toString(),
          quote.createdAt,
          quote.expiresAt,
          route,
        ].join('|'),
      ),
    );
  }
}
