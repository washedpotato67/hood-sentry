import type {
  DexAdapter,
  NormalizedPool,
  NormalizedQuote,
  NormalizedRouteStep,
  PreparedProtocolTransaction,
  ProtocolExecutionClient,
} from '@hood-sentry/chain';
import { type Database, type ProtocolRepository, schema } from '@hood-sentry/db';
import { AppError, ForbiddenError, ValidationError } from '@hood-sentry/shared';
import {
  type IntentRequest,
  type TransactionIntent,
  TransactionIntentService,
} from '@hood-sentry/trading';
import { and, eq } from 'drizzle-orm';
import {
  encodeFunctionData,
  erc20Abi,
  getAddress,
  isHash,
  keccak256,
  toFunctionSelector,
} from 'viem';

const APPROVE_SELECTOR = toFunctionSelector('approve(address,uint256)');
const MAX_CANDIDATE_ROUTES = 32;
const MAX_CACHED_QUOTES = 5_000;

type TradingAdapter = Pick<
  DexAdapter,
  'chainId' | 'getQuote' | 'prepareSwapTransaction' | 'protocolKey' | 'version'
>;

export type TradingRuntime = {
  adapters: readonly TradingAdapter[];
  client: Pick<ProtocolExecutionClient, 'getBytecode' | 'getChainId' | 'simulateTransaction'>;
  allowedSpenders: ReadonlySet<string>;
};

export type TradingServiceConfig = {
  chainId: number;
  enabled: boolean;
  mainnetWritesEnabled: boolean;
  configurationVersion: string;
  quoteTtlSeconds: number;
};

export type TradingTransactionReader = {
  getTransaction(hash: `0x${string}`): Promise<{
    from: `0x${string}`;
    to: `0x${string}` | null;
    input: `0x${string}`;
    value: bigint;
  }>;
  getTransactionReceipt(hash: `0x${string}`): Promise<{
    transactionHash: `0x${string}`;
    status: 'success' | 'reverted';
    blockNumber: bigint;
    blockHash: `0x${string}`;
  }>;
};

export type QuoteInput = {
  chainId: number;
  inputTokenAddress: `0x${string}`;
  outputTokenAddress: `0x${string}`;
  amountInRaw: bigint;
  slippageBps: bigint;
  maximumPriceImpactBps: bigint;
  protocolKey?: string;
};

type PersistedIntentType = 'approve' | 'swap';

function routeStep(
  pool: NormalizedPool,
  inputTokenAddress: `0x${string}`,
  outputTokenAddress: `0x${string}`,
): NormalizedRouteStep {
  return {
    protocolKey: pool.protocolKey,
    protocolVersion: pool.protocolVersion,
    poolAddress: pool.poolAddress,
    inputTokenAddress,
    outputTokenAddress,
    feeTier: pool.feeTier,
  };
}

function otherToken(pool: NormalizedPool, address: string): `0x${string}` | null {
  if (pool.token0Address.toLowerCase() === address.toLowerCase()) return pool.token1Address;
  if (pool.token1Address.toLowerCase() === address.toLowerCase()) return pool.token0Address;
  return null;
}

function includesToken(pool: NormalizedPool, address: string): boolean {
  const key = address.toLowerCase();
  return pool.token0Address.toLowerCase() === key || pool.token1Address.toLowerCase() === key;
}

function jsonSimulation(simulation: TransactionIntent['simulation']) {
  return {
    success: simulation.success,
    gasUsed: simulation.gasUsed?.toString(),
    revertData: simulation.revertData,
  };
}

export class TradingService {
  private readonly quotes = new Map<string, NormalizedQuote>();

  constructor(
    private readonly database: Database,
    private readonly protocols: Pick<ProtocolRepository, 'getActivePools' | 'saveQuote'>,
    private readonly runtime: TradingRuntime | null,
    private readonly config: TradingServiceConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly transactions: TradingTransactionReader | null = null,
  ) {}

  status() {
    return {
      available: this.runtime !== null && this.runtime.adapters.length > 0,
      writesEnabled:
        this.config.enabled && (this.config.chainId !== 4663 || this.config.mainnetWritesEnabled),
      chainId: this.config.chainId,
      adapters:
        this.runtime?.adapters.map((adapter) => ({
          protocolKey: adapter.protocolKey,
          protocolVersion: adapter.version,
        })) ?? [],
      configurationVersion: this.config.configurationVersion,
    };
  }

  async quote(input: QuoteInput): Promise<NormalizedQuote> {
    const runtime = this.requireRuntime(input.chainId);
    if (input.inputTokenAddress.toLowerCase() === input.outputTokenAddress.toLowerCase()) {
      throw new ValidationError('Input and output tokens must differ');
    }
    const pools = await this.protocols.getActivePools(input.chainId);
    const candidates = this.routeCandidates(pools, input);
    if (candidates.length === 0) {
      throw new AppError('QUOTE_UNAVAILABLE', 'No verified route exists for this pair', 503);
    }
    const provisional: Array<{
      adapter: TradingAdapter;
      route: readonly NormalizedRouteStep[];
      quote: NormalizedQuote;
    }> = [];
    for (const candidate of candidates) {
      const adapter = runtime.adapters.find(
        (entry) =>
          entry.chainId === input.chainId &&
          entry.protocolKey === candidate[0]?.protocolKey &&
          entry.version === candidate[0]?.protocolVersion,
      );
      if (adapter === undefined) continue;
      try {
        const quote = await adapter.getQuote({
          chainId: input.chainId,
          protocolKey: adapter.protocolKey,
          inputTokenAddress: input.inputTokenAddress,
          outputTokenAddress: input.outputTokenAddress,
          amountInRaw: input.amountInRaw,
          minimumAmountOutRaw: 1n,
          route: candidate,
          ttlSeconds: this.config.quoteTtlSeconds,
        });
        if (
          quote.expectedAmountOutRaw > 0n &&
          (quote.priceImpactBps === undefined ||
            quote.priceImpactBps <= input.maximumPriceImpactBps)
        ) {
          provisional.push({ adapter, route: candidate, quote });
        }
      } catch {
        // A route that cannot be quoted is not an error: the next candidate is tried,
        // and exhausting every candidate throws QUOTE_UNAVAILABLE below.
      }
    }
    provisional.sort((left, right) =>
      left.quote.expectedAmountOutRaw === right.quote.expectedAmountOutRaw
        ? 0
        : left.quote.expectedAmountOutRaw > right.quote.expectedAmountOutRaw
          ? -1
          : 1,
    );
    for (const candidate of provisional) {
      const minimumAmountOutRaw =
        (candidate.quote.expectedAmountOutRaw * (10_000n - input.slippageBps)) / 10_000n;
      try {
        const quote = await candidate.adapter.getQuote({
          chainId: input.chainId,
          protocolKey: candidate.adapter.protocolKey,
          inputTokenAddress: input.inputTokenAddress,
          outputTokenAddress: input.outputTokenAddress,
          amountInRaw: input.amountInRaw,
          minimumAmountOutRaw: minimumAmountOutRaw > 0n ? minimumAmountOutRaw : 1n,
          route: candidate.route,
          ttlSeconds: this.config.quoteTtlSeconds,
        });
        await this.protocols.saveQuote(quote);
        this.rememberQuote(quote);
        return quote;
      } catch {
        // Same policy as the provisional pass: fall through to the next candidate.
      }
    }
    throw new AppError(
      'QUOTE_UNAVAILABLE',
      'No verified executable route returned a safe quote',
      503,
    );
  }

  async prepareSwap(input: {
    quoteId: string;
    userId: string;
    walletAddress: string;
  }): Promise<TransactionIntent> {
    this.assertWritesEnabled();
    const quote = this.requireQuote(input.quoteId);
    const runtime = this.requireRuntime(quote.chainId);
    const adapter = runtime.adapters.find(
      (entry) =>
        entry.chainId === quote.chainId &&
        entry.protocolKey === quote.protocolKey &&
        entry.version === quote.protocolVersion,
    );
    if (adapter === undefined)
      throw new AppError('TRADING_UNAVAILABLE', 'Quote adapter is inactive', 503);
    let prepared: PreparedProtocolTransaction;
    try {
      prepared = await adapter.prepareSwapTransaction(quote, getAddress(input.walletAddress));
    } catch {
      throw new ValidationError('Quote validation or swap simulation failed');
    }
    const remainingSeconds = Math.floor(
      (new Date(quote.expiresAt).getTime() - this.now().getTime()) / 1_000,
    );
    if (remainingSeconds < 1) throw new ValidationError('Quote expired');
    return this.createIntent(
      {
        userId: input.userId,
        wallet: getAddress(input.walletAddress),
        chainId: quote.chainId,
        target: prepared.to,
        functionSelector: prepared.functionSelector,
        functionName: 'swapExactTokensForTokens',
        decodedArguments: [
          quote.amountInRaw.toString(),
          quote.minimumAmountOutRaw.toString(),
          quote.route.map((step) => step.inputTokenAddress).concat(quote.outputTokenAddress),
          getAddress(input.walletAddress),
          prepared.deadline.toString(),
        ],
        calldata: prepared.data,
        nativeValue: prepared.value,
        tokenAmounts: [
          { token: quote.inputTokenAddress, amount: quote.amountInRaw },
          { token: quote.outputTokenAddress, amount: quote.expectedAmountOutRaw },
        ],
        spender: prepared.spenderAddress,
        approvalAmount: quote.amountInRaw,
        expectedResult: `Receive at least ${quote.minimumAmountOutRaw.toString()} raw output units`,
        featureFlag: 'trading',
        configurationVersion: this.config.configurationVersion,
        quoteId: quote.quoteId,
        ttlSeconds: Math.min(remainingSeconds, 300),
      },
      'swap',
    );
  }

  async prepareApproval(input: {
    userId: string;
    walletAddress: string;
    chainId: number;
    tokenAddress: string;
    spenderAddress: string;
    amountRaw: bigint;
  }): Promise<TransactionIntent> {
    this.assertWritesEnabled();
    const runtime = this.requireRuntime(input.chainId);
    const wallet = getAddress(input.walletAddress);
    const token = getAddress(input.tokenAddress);
    const spender = getAddress(input.spenderAddress);
    if (!runtime.allowedSpenders.has(spender.toLowerCase())) {
      throw new ForbiddenError('Approval spender is not a verified active protocol contract');
    }
    await this.assertTokenIdentity(token, runtime);
    const calldata = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender, input.amountRaw],
    });
    return this.createIntent(
      {
        userId: input.userId,
        wallet,
        chainId: input.chainId,
        target: token,
        functionSelector: APPROVE_SELECTOR,
        functionName: 'approve',
        decodedArguments: [spender, input.amountRaw.toString()],
        calldata,
        nativeValue: 0n,
        tokenAmounts: [{ token, amount: input.amountRaw }],
        spender,
        approvalAmount: input.amountRaw,
        expectedResult:
          input.amountRaw === 0n
            ? `Revoke ${spender} allowance`
            : `Set ${spender} allowance to ${input.amountRaw.toString()} raw units`,
        featureFlag: 'trading',
        configurationVersion: this.config.configurationVersion,
        ttlSeconds: 120,
      },
      'approve',
    );
  }

  async recordBroadcast(input: {
    intentId: string;
    transactionHash: string;
    userId: string;
    walletAddress: string;
  }) {
    const row = await this.ownedIntent(input.intentId, input.userId, input.walletAddress);
    if (row.status === 'broadcast' || row.status === 'confirmed') {
      if (row.txHash?.toLowerCase() !== input.transactionHash.toLowerCase()) {
        throw new ForbiddenError('Intent already binds a different transaction hash');
      }
      return { intentId: input.intentId, transactionHash: row.txHash, status: row.status };
    }
    if (row.status !== 'simulated' || row.deadline === null || row.deadline <= this.now()) {
      throw new ForbiddenError('Only an active simulated intent accepts a broadcast');
    }
    if (!isHash(input.transactionHash)) throw new ValidationError('Transaction hash is invalid');
    const reader = this.requireTransactionReader();
    let transaction: Awaited<ReturnType<TradingTransactionReader['getTransaction']>>;
    try {
      transaction = await reader.getTransaction(input.transactionHash);
    } catch {
      throw new AppError(
        'TRANSACTION_NOT_VISIBLE',
        'The transaction is not visible through the configured provider yet',
        409,
      );
    }
    if (
      transaction.from.toLowerCase() !== row.walletAddress?.toLowerCase() ||
      transaction.to?.toLowerCase() !== row.targetAddress.toLowerCase() ||
      transaction.input.toLowerCase() !== row.calldata?.toLowerCase() ||
      transaction.value !== BigInt(row.valueRaw ?? '0')
    ) {
      throw new ForbiddenError('Broadcast transaction does not match the simulated intent');
    }
    await this.database.db.transaction(async (databaseTransaction) => {
      await databaseTransaction
        .update(schema.transactionIntents)
        .set({
          status: 'broadcast',
          txHash: input.transactionHash.toLowerCase(),
          executedAt: this.now(),
        })
        .where(
          and(
            eq(schema.transactionIntents.id, row.id),
            eq(schema.transactionIntents.status, 'simulated'),
          ),
        );
      await databaseTransaction.insert(schema.transactionIntentEvents).values({
        transactionIntentId: row.id,
        action: 'broadcast',
        metadata: { transactionHash: input.transactionHash.toLowerCase() },
        createdAt: this.now(),
      });
    });
    return {
      intentId: input.intentId,
      transactionHash: input.transactionHash,
      status: 'broadcast',
    };
  }

  async recordConfirmation(input: {
    intentId: string;
    transactionHash: string;
    userId: string;
    walletAddress: string;
  }) {
    const row = await this.ownedIntent(input.intentId, input.userId, input.walletAddress);
    if (!isHash(input.transactionHash)) throw new ValidationError('Transaction hash is invalid');
    if (row.txHash?.toLowerCase() !== input.transactionHash.toLowerCase()) {
      throw new ForbiddenError('Transaction hash does not match the intent');
    }
    if (row.status === 'confirmed') {
      return { intentId: input.intentId, transactionHash: row.txHash, status: 'confirmed' };
    }
    if (row.status !== 'broadcast')
      throw new ForbiddenError('Intent has not passed broadcast review');
    const reader = this.requireTransactionReader();
    let receipt: Awaited<ReturnType<TradingTransactionReader['getTransactionReceipt']>>;
    try {
      receipt = await reader.getTransactionReceipt(input.transactionHash);
    } catch {
      throw new AppError(
        'RECEIPT_NOT_VISIBLE',
        'The transaction receipt is not available yet',
        409,
      );
    }
    if (receipt.status !== 'success') {
      await this.database.db
        .update(schema.transactionIntents)
        .set({ status: 'failed' })
        .where(eq(schema.transactionIntents.id, row.id));
      throw new ValidationError('The transaction reverted on chain');
    }
    await this.database.db.transaction(async (databaseTransaction) => {
      await databaseTransaction
        .update(schema.transactionIntents)
        .set({ status: 'confirmed' })
        .where(
          and(
            eq(schema.transactionIntents.id, row.id),
            eq(schema.transactionIntents.status, 'broadcast'),
          ),
        );
      await databaseTransaction.insert(schema.transactionIntentEvents).values({
        transactionIntentId: row.id,
        action: 'confirmed',
        metadata: {
          transactionHash: receipt.transactionHash.toLowerCase(),
          blockNumber: receipt.blockNumber.toString(),
          blockHash: receipt.blockHash.toLowerCase(),
        },
        createdAt: this.now(),
      });
    });
    return {
      intentId: input.intentId,
      transactionHash: receipt.transactionHash,
      status: 'confirmed',
      blockNumber: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash,
    };
  }

  private requireRuntime(chainId: number): TradingRuntime {
    if (chainId !== this.config.chainId) throw new ValidationError('Chain ID does not match');
    if (this.runtime === null || this.runtime.adapters.length === 0) {
      throw new AppError('TRADING_UNAVAILABLE', 'No verified trading adapter is active', 503);
    }
    return this.runtime;
  }

  private assertWritesEnabled(): void {
    if (!this.config.enabled) throw new ForbiddenError('Trading writes are disabled');
    if (this.config.chainId === 4663 && !this.config.mainnetWritesEnabled) {
      throw new ForbiddenError('Mainnet writes are disabled');
    }
  }

  private routeCandidates(
    pools: readonly NormalizedPool[],
    input: QuoteInput,
  ): readonly (readonly NormalizedRouteStep[])[] {
    const adapters = new Set(
      this.runtime?.adapters
        .filter(
          (adapter) =>
            adapter.chainId === input.chainId &&
            (input.protocolKey === undefined || adapter.protocolKey === input.protocolKey),
        )
        .map((adapter) => `${adapter.protocolKey}:${adapter.version}`) ?? [],
    );
    const eligible = pools.filter(
      (pool) =>
        pool.canonical &&
        pool.poolType === 'constantProduct' &&
        adapters.has(`${pool.protocolKey}:${pool.protocolVersion}`),
    );
    const routes: NormalizedRouteStep[][] = [];
    for (const first of eligible) {
      const intermediate = otherToken(first, input.inputTokenAddress);
      if (intermediate === null) continue;
      if (intermediate.toLowerCase() === input.outputTokenAddress.toLowerCase()) {
        routes.push([routeStep(first, input.inputTokenAddress, input.outputTokenAddress)]);
        continue;
      }
      for (const second of eligible) {
        if (
          second.poolAddress.toLowerCase() === first.poolAddress.toLowerCase() ||
          second.protocolKey !== first.protocolKey ||
          second.protocolVersion !== first.protocolVersion ||
          !includesToken(second, intermediate) ||
          !includesToken(second, input.outputTokenAddress)
        ) {
          continue;
        }
        routes.push([
          routeStep(first, input.inputTokenAddress, intermediate),
          routeStep(second, intermediate, input.outputTokenAddress),
        ]);
        if (routes.length >= MAX_CANDIDATE_ROUTES) return routes;
      }
    }
    return routes.slice(0, MAX_CANDIDATE_ROUTES);
  }

  private rememberQuote(quote: NormalizedQuote): void {
    const now = this.now().getTime();
    for (const [quoteId, cached] of this.quotes) {
      if (new Date(cached.expiresAt).getTime() <= now) this.quotes.delete(quoteId);
    }
    while (this.quotes.size >= MAX_CACHED_QUOTES) {
      const oldest = this.quotes.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.quotes.delete(oldest);
    }
    this.quotes.set(quote.quoteId, quote);
  }

  private requireQuote(quoteId: string): NormalizedQuote {
    const quote = this.quotes.get(quoteId);
    if (quote === undefined) throw new ValidationError('Quote is unknown or no longer active');
    if (new Date(quote.expiresAt).getTime() <= this.now().getTime()) {
      this.quotes.delete(quoteId);
      throw new ValidationError('Quote expired');
    }
    return quote;
  }

  private async assertTokenIdentity(token: `0x${string}`, runtime: TradingRuntime): Promise<void> {
    const rows = await this.database.db
      .select({
        tokenType: schema.tokens.token_type,
        bytecodeHash: schema.contracts.bytecode_hash,
      })
      .from(schema.tokens)
      .innerJoin(
        schema.contracts,
        and(
          eq(schema.contracts.chain_id, schema.tokens.chain_id),
          eq(schema.contracts.address, schema.tokens.address),
        ),
      )
      .where(
        and(
          eq(schema.tokens.chain_id, this.config.chainId),
          eq(schema.tokens.address, token.toLowerCase()),
        ),
      )
      .limit(1);
    const identity = rows[0];
    if (identity?.tokenType !== 'erc20' || identity.bytecodeHash === null) {
      throw new ForbiddenError('Approval target lacks an indexed ERC-20 bytecode identity');
    }
    const bytecode = await runtime.client.getBytecode(token);
    if (
      bytecode === undefined ||
      bytecode === '0x' ||
      keccak256(bytecode).toLowerCase() !== identity.bytecodeHash.toLowerCase()
    ) {
      throw new ForbiddenError('Approval target bytecode does not match indexed evidence');
    }
  }

  private async createIntent(
    request: IntentRequest,
    intentType: PersistedIntentType,
  ): Promise<TransactionIntent> {
    const runtime = this.requireRuntime(request.chainId);
    const chainId = await runtime.client.getChainId();
    if (chainId !== request.chainId) throw new ForbiddenError('RPC chain ID does not match');
    const service = new TransactionIntentService(
      {
        simulate: async (intent) => {
          const result = await runtime.client.simulateTransaction({
            account: intent.wallet,
            to: intent.target,
            data: intent.calldata,
            value: intent.nativeValue,
          });
          return {
            success: result.success,
            gasUsed: result.gasUsed,
            revertData: result.success ? undefined : result.returnValue,
          };
        },
        isFeatureEnabled: () =>
          this.config.enabled && (this.config.chainId !== 4663 || this.config.mainnetWritesEnabled),
        isTargetAllowed: (target, intentChainId) =>
          intentChainId === this.config.chainId &&
          target.toLowerCase() === request.target.toLowerCase(),
        isSelectorAllowed: (target, selector) =>
          target.toLowerCase() === request.target.toLowerCase() &&
          selector.toLowerCase() === request.functionSelector.toLowerCase(),
        record: async () => undefined,
      },
      this.now,
    );
    let intent: TransactionIntent;
    try {
      intent = await service.create(request);
    } catch {
      throw new ValidationError('Transaction simulation failed');
    }
    await this.database.db.transaction(async (transaction) => {
      const rows = await transaction
        .insert(schema.transactionIntents)
        .values({
          intentHash: intent.intentId,
          userId: intent.userId,
          chainId: intent.chainId,
          walletAddress: intent.wallet.toLowerCase(),
          intentType,
          targetAddress: intent.target.toLowerCase(),
          functionSelector: intent.functionSelector,
          functionName: intent.functionName,
          decodedArguments: intent.decodedArguments,
          calldata: intent.calldata,
          valueRaw: intent.nativeValue.toString(),
          tokenAmounts: intent.tokenAmounts.map((amount) => ({
            token: amount.token.toLowerCase(),
            amountRaw: amount.amount.toString(),
          })),
          spenderAddress: intent.spender?.toLowerCase(),
          approvalAmountRaw: intent.approvalAmount?.toString(),
          expectedResult: intent.expectedResult,
          deadline: new Date(intent.expiresAt),
          simulationResult: jsonSimulation(intent.simulation),
          warnings: intent.warnings,
          featureFlag: intent.featureFlag,
          configurationVersion: intent.configurationVersion,
          quoteId: intent.quoteId,
          status: 'simulated',
          createdAt: new Date(intent.createdAt),
        })
        .returning({ id: schema.transactionIntents.id });
      const row = rows[0];
      if (row === undefined) throw new Error('TRANSACTION_INTENT_INSERT_FAILED');
      await transaction.insert(schema.transactionIntentEvents).values({
        transactionIntentId: row.id,
        action: 'created',
        metadata: {
          intentHash: intent.intentId,
          simulationSuccess: intent.simulation.success,
          configurationVersion: intent.configurationVersion,
        },
        createdAt: new Date(intent.createdAt),
      });
    });
    return intent;
  }

  private requireTransactionReader(): TradingTransactionReader {
    if (this.transactions === null) {
      throw new AppError(
        'TRANSACTION_TRACKING_UNAVAILABLE',
        'Transaction tracking is unavailable',
        503,
      );
    }
    return this.transactions;
  }

  private async ownedIntent(intentId: string, userId: string, walletAddress: string) {
    const rows = await this.database.db
      .select()
      .from(schema.transactionIntents)
      .where(
        and(
          eq(schema.transactionIntents.intentHash, intentId),
          eq(schema.transactionIntents.userId, userId),
          eq(schema.transactionIntents.walletAddress, walletAddress.toLowerCase()),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (row === undefined)
      throw new ForbiddenError('Transaction intent is not owned by this wallet');
    return row;
  }
}

export function serializeQuote(quote: NormalizedQuote) {
  return {
    ...quote,
    amountInRaw: quote.amountInRaw.toString(),
    expectedAmountOutRaw: quote.expectedAmountOutRaw.toString(),
    minimumAmountOutRaw: quote.minimumAmountOutRaw.toString(),
    estimatedGas: quote.estimatedGas?.toString(),
    priceImpactBps: quote.priceImpactBps?.toString(),
    protocolFeeRaw: quote.protocolFeeRaw?.toString(),
    sourceBlockNumber: quote.sourceBlockNumber.toString(),
    route: quote.route.map((step) => ({
      ...step,
      feeTier: step.feeTier?.toString(),
    })),
    allowanceRequirement:
      quote.spenderAddress === undefined
        ? null
        : { spenderAddress: quote.spenderAddress, amountRaw: quote.amountInRaw.toString() },
  };
}

export function serializeIntent(intent: TransactionIntent) {
  return {
    ...intent,
    nativeValue: intent.nativeValue.toString(),
    tokenAmounts: intent.tokenAmounts.map((amount) => ({
      token: amount.token,
      amountRaw: amount.amount.toString(),
    })),
    approvalAmount: intent.approvalAmount?.toString(),
    simulation: jsonSimulation(intent.simulation),
  };
}
