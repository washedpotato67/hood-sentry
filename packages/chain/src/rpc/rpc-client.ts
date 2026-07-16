import {
  http,
  type Address,
  type Block,
  type Chain,
  type Hash,
  type Hex,
  type Log,
  type PublicClient,
  type Transaction,
  type TransactionReceipt,
  type Transport,
  createPublicClient,
  keccak256,
} from 'viem';
import { BlockLagMonitor } from './block-lag-monitor.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { ProviderHealthTracker } from './health-tracker.js';
import { ProviderSelector } from './provider-selector.js';
import { RateLimiter } from './rate-limiter.js';
import { RetryPolicy } from './retry-policy.js';
import type {
  FeeEstimate,
  GasEstimate,
  MulticallRequest,
  MulticallResult,
  ProviderConfig,
  ProviderHealth,
  RPCClientConfig,
  RPCMethod,
  TransactionSimulationResult,
  WebSocketSubscription,
} from './types.js';
import { ContractRevertError, ProviderUnavailableError } from './types.js';
import { WebSocketManager } from './websocket-manager.js';

export class RPCClient {
  private readonly config: RPCClientConfig;
  private readonly chain: Chain;
  private readonly clients: Map<string, PublicClient<Transport, Chain>> = new Map();
  private readonly circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private readonly rateLimiters: Map<string, RateLimiter> = new Map();
  private readonly healthTrackers: Map<string, ProviderHealthTracker> = new Map();
  private readonly blockLagMonitor: BlockLagMonitor;
  private readonly retryPolicy: RetryPolicy;
  private readonly providerSelector: ProviderSelector;
  private readonly websocketManagers: Map<string, WebSocketManager> = new Map();
  private readonly broadcastedTransactions: Set<Hash> = new Set();
  private healthCheckTimer: NodeJS.Timeout | null = null;

  constructor(chain: Chain, config: RPCClientConfig) {
    this.chain = chain;
    this.config = config;

    // Initialize block lag monitor
    this.blockLagMonitor = new BlockLagMonitor({
      maxAcceptableLag: config.healthCheck.maxBlockLag,
    });

    // Initialize retry policy
    this.retryPolicy = new RetryPolicy({
      maxAttempts: config.retry.maxAttempts,
      baseDelayMs: config.retry.baseDelayMs,
      maxDelayMs: config.retry.maxDelayMs,
      backoffMultiplier: config.retry.backoffMultiplier,
    });

    // Initialize providers
    this.initializeProvider(config.primary);
    if (config.secondary) {
      this.initializeProvider(config.secondary);
    }
    if (config.archive) {
      this.initializeProvider(config.archive);
    }

    // Initialize provider selector
    this.providerSelector = new ProviderSelector(
      config.primary.url,
      config.secondary?.url,
      config.archive?.url,
      this.healthTrackers,
      this.blockLagMonitor,
      {
        maxAcceptableLag: config.healthCheck.maxBlockLag,
        requireArchiveForHistorical: config.archive !== undefined,
      },
    );

    // Initialize WebSocket managers
    if (config.websocket?.primary) {
      this.initializeWebSocketManager('primary', config.websocket.primary);
    }
    if (config.websocket?.secondary) {
      this.initializeWebSocketManager('secondary', config.websocket.secondary);
    }

    // Start health checks
    this.startHealthChecks();
  }

  private initializeProvider(config: ProviderConfig): void {
    const client = createPublicClient({
      chain: this.chain,
      transport: http(config.url, {
        timeout: config.timeout ?? 30000,
      }),
    });

    this.clients.set(config.url, client);

    // Initialize circuit breaker
    const circuitBreaker = new CircuitBreaker(config.url, {
      failureThreshold: this.config.circuitBreaker.failureThreshold,
      resetTimeoutMs: this.config.circuitBreaker.resetTimeoutMs,
      halfOpenMaxRequests: this.config.circuitBreaker.halfOpenMaxRequests,
    });
    this.circuitBreakers.set(config.url, circuitBreaker);

    // Initialize rate limiter
    if (config.rateLimit) {
      const rateLimiter = new RateLimiter(config.url, config.rateLimit);
      this.rateLimiters.set(config.url, rateLimiter);
    }

    // Initialize health tracker
    const healthTracker = new ProviderHealthTracker(config.url, config.role, circuitBreaker);
    this.healthTrackers.set(config.url, healthTracker);
  }

  private initializeWebSocketManager(role: 'primary' | 'secondary', config: ProviderConfig): void {
    const manager = new WebSocketManager(role, {
      url: config.url,
      chain: this.chain,
      reconnectEnabled: true,
      maxReconnectAttempts: 10,
      reconnectBaseDelayMs: 1000,
      reconnectMaxDelayMs: 30000,
      pingIntervalMs: 30000,
      pongTimeoutMs: 10000,
    });
    this.websocketManagers.set(config.url, manager);
  }

  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthChecks();
    }, this.config.healthCheck.intervalMs);
  }

  private async performHealthChecks(): Promise<void> {
    for (const [url, client] of this.clients.entries()) {
      await this.checkProviderHealth(url, client);
    }
  }

  private async checkProviderHealth(
    url: string,
    client: PublicClient<Transport, Chain>,
  ): Promise<void> {
    try {
      const startTime = Date.now();

      const isValid = await this.validateChainId(url, client);
      if (!isValid) {
        return;
      }

      await this.updateBlockInfo(url, client, startTime);

      if (url === this.config.archive?.url) {
        await this.checkArchiveCapability(url, client);
      }
    } catch (_error) {
      const tracker = this.healthTrackers.get(url);
      tracker?.recordFailure();
    }
  }

  private async validateChainId(
    url: string,
    client: PublicClient<Transport, Chain>,
  ): Promise<boolean> {
    const chainId = await client.getChainId();
    if (chainId !== this.config.chainId) {
      const tracker = this.healthTrackers.get(url);
      if (tracker) {
        tracker.setChainIdMatch(false);
        tracker.recordFailure();
      }
      return false;
    }
    return true;
  }

  private async updateBlockInfo(
    url: string,
    client: PublicClient<Transport, Chain>,
    startTime: number,
  ): Promise<void> {
    const blockNumber = await client.getBlockNumber();
    const block = await client.getBlock({ blockNumber });

    this.blockLagMonitor.updateProviderBlock(url, blockNumber);
    this.blockLagMonitor.updateNetworkHead(blockNumber);

    const tracker = this.healthTrackers.get(url);
    if (tracker) {
      tracker.updateBlockInfo(blockNumber, block.hash);
      tracker.setChainIdMatch(true);
      tracker.recordSuccess(Date.now() - startTime);
    }
  }

  private async checkArchiveCapability(
    url: string,
    client: PublicClient<Transport, Chain>,
  ): Promise<void> {
    const tracker = this.healthTrackers.get(url);
    try {
      const blockNumber = await client.getBlockNumber();
      const oldBlockNumber = blockNumber > 1000n ? blockNumber - 1000n : 1n;
      await client.getBlock({ blockNumber: oldBlockNumber });
      tracker?.setArchiveCapable(true);
    } catch {
      tracker?.setArchiveCapable(false);
    }
  }

  async getBlockNumber(): Promise<bigint> {
    return this.executeWithFailover('eth_blockNumber', async (client) => {
      return await client.getBlockNumber();
    });
  }

  async getChainId(): Promise<number> {
    return this.executeWithFailover('eth_chainId', async (client) => {
      return await client.getChainId();
    });
  }

  async getBlock(params: {
    blockNumber?: bigint;
    blockHash?: Hash;
    includeTransactions?: boolean;
  }): Promise<Block> {
    return this.executeWithFailover('eth_getBlockByNumber', async (client) => {
      if (params.blockHash) {
        return await client.getBlock({
          blockHash: params.blockHash,
          includeTransactions: params.includeTransactions,
        });
      }
      return await client.getBlock({
        blockNumber: params.blockNumber,
        includeTransactions: params.includeTransactions,
      });
    });
  }

  async getTransaction(hash: Hash): Promise<Transaction> {
    return this.executeWithFailover('eth_getTransactionByHash', async (client) => {
      return await client.getTransaction({ hash });
    });
  }

  async getTransactionReceipt(hash: Hash): Promise<TransactionReceipt> {
    return this.executeWithFailover('eth_getTransactionReceipt', async (client) => {
      return await client.getTransactionReceipt({ hash });
    });
  }

  async getLogs(params: {
    address?: Address | Address[];
    fromBlock?: bigint;
    toBlock?: bigint;
    topics?: (Hex | Hex[] | null)[];
  }): Promise<Log[]> {
    return this.executeWithFailover('eth_getLogs', async (client) => {
      return await client.getLogs(params);
    });
  }

  async getCode(address: Address, blockNumber?: bigint): Promise<Hex> {
    return this.executeWithFailover('eth_getCode', async (client) => {
      const bytecode = await client.getBytecode({ address, blockNumber });
      return bytecode ?? '0x';
    });
  }

  async getStorageAt(address: Address, slot: Hash, blockNumber?: bigint): Promise<Hex> {
    return this.executeWithFailover('eth_getStorageAt', async (client) => {
      const value = await client.getStorageAt({ address, slot, blockNumber });
      return value ?? '0x';
    });
  }

  async call(params: { to: Address; data: Hex; blockNumber?: bigint }): Promise<Hex> {
    return this.executeWithFailover('eth_call', async (client) => {
      try {
        return await client
          .call({
            to: params.to,
            data: params.data,
            blockNumber: params.blockNumber,
          })
          .then((r) => r.data ?? '0x');
      } catch (error: unknown) {
        if (this.isContractRevertError(error)) {
          throw new ContractRevertError(client.transport.url, error.message, error.data);
        }
        throw error;
      }
    });
  }

  private isContractRevertError(error: unknown): error is { message: string; data?: Hex } {
    return (
      error instanceof Error &&
      error.message?.includes('revert') &&
      (error as { data?: unknown }).data !== undefined
    );
  }

  async multicall(requests: MulticallRequest[], blockNumber?: bigint): Promise<MulticallResult[]> {
    return this.executeWithFailover('eth_call', async (client) => {
      const results = await client.multicall({
        contracts: requests.map((r) => ({
          address: r.target,
          abi: [
            {
              type: 'function',
              name: 'call',
              inputs: [],
              outputs: [{ type: 'bytes' }],
              stateMutability: 'view',
            },
          ] as const,
          functionName: 'call',
          args: [],
        })),
        blockNumber,
        allowFailure: true,
      });

      return results.map((r, _i) => ({
        success: r.status === 'success',
        returnData: r.status === 'success' ? (r.result as Hex) : '0x',
        gasUsed: 0n, // Multicall doesn't provide per-call gas
      }));
    });
  }

  async estimateGas(params: {
    to: Address;
    data?: Hex;
    value?: bigint;
    from?: Address;
  }): Promise<GasEstimate> {
    return this.executeWithFailover('eth_estimateGas', async (client) => {
      const gasLimit = await client.estimateGas(params);

      let maxFeePerGas: bigint | undefined;
      let maxPriorityFeePerGas: bigint | undefined;
      let gasPrice: bigint | undefined;

      try {
        const feeData = await client.estimateFeesPerGas();
        maxFeePerGas = feeData.maxFeePerGas;
        maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
      } catch {
        gasPrice = await client.getGasPrice();
      }

      return {
        gasLimit,
        maxFeePerGas,
        maxPriorityFeePerGas,
        gasPrice,
      };
    });
  }

  async estimateFees(): Promise<FeeEstimate> {
    return this.executeWithFailover('eth_gasPrice', async (client) => {
      const block = await client.getBlock();
      const baseFee = block.baseFeePerGas ?? 0n;

      try {
        const maxPriorityFeePerGas = await client.estimateMaxPriorityFeePerGas();
        const maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;
        const gasPrice = await client.getGasPrice();

        return {
          baseFee,
          maxPriorityFeePerGas,
          maxFeePerGas,
          gasPrice,
        };
      } catch {
        const gasPrice = await client.getGasPrice();
        return {
          baseFee,
          maxPriorityFeePerGas: gasPrice / 10n,
          maxFeePerGas: gasPrice,
          gasPrice,
        };
      }
    });
  }

  async sendRawTransaction(signedTransaction: Hex): Promise<Hash> {
    // Check if we've already broadcast this transaction
    const hash = calculateSerializedTransactionHash(signedTransaction);
    if (this.broadcastedTransactions.has(hash)) {
      return hash;
    }

    return this.executeWithFailover('eth_sendRawTransaction', async (client) => {
      const actualChainId = await client.getChainId();
      if (actualChainId !== this.config.chainId) {
        throw new Error(
          `Refusing transaction broadcast on chain ${actualChainId}, expected ${this.config.chainId}`,
        );
      }

      const txHash = await client.sendRawTransaction({ serializedTransaction: signedTransaction });
      if (txHash.toLowerCase() !== hash.toLowerCase()) {
        throw new Error('RPC returned a transaction hash which does not match the signed payload');
      }
      this.broadcastedTransactions.add(txHash);
      return txHash;
    });
  }

  async simulateTransaction(params: {
    from: Address;
    to: Address;
    data: Hex;
    value?: bigint;
    gas?: bigint;
  }): Promise<TransactionSimulationResult> {
    return this.executeWithFailover('eth_simulateV1', async (client) => {
      try {
        const gasUsed = await client.estimateGas({
          account: params.from,
          to: params.to,
          data: params.data,
          value: params.value,
          gas: params.gas,
        });

        const result = await client.call({
          account: params.from,
          to: params.to,
          data: params.data,
          value: params.value,
          gas: params.gas,
        });

        return {
          success: true,
          gasUsed,
          returnValue: result.data ?? '0x',
        };
      } catch (error: unknown) {
        return {
          success: false,
          gasUsed: 0n,
          returnValue: '0x',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  }

  async subscribeToNewHeads(callback: (block: Block) => void): Promise<string> {
    const manager = this.getWebSocketManager();
    if (!manager) {
      throw new Error('No WebSocket connection available');
    }

    const subscription: WebSocketSubscription = {
      id: `newHeads_${Date.now()}`,
      type: 'newHeads',
      callback: (data: unknown) => callback(data as Block),
    };

    return await manager.subscribe(subscription);
  }

  async subscribeToLogs(
    filter: { address?: Address | Address[]; topics?: (Hex | Hex[] | null)[] },
    callback: (logs: Log[]) => void,
  ): Promise<string> {
    const manager = this.getWebSocketManager();
    if (!manager) {
      throw new Error('No WebSocket connection available');
    }

    const subscription: WebSocketSubscription = {
      id: `logs_${Date.now()}`,
      type: 'logs',
      callback: (data: unknown) => callback(data as Log[]),
      filter,
    };

    return await manager.subscribe(subscription);
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    for (const manager of this.websocketManagers.values()) {
      try {
        await manager.unsubscribe(subscriptionId);
      } catch {
        // Ignore errors
      }
    }
  }

  private async executeWithFailover<T>(
    method: RPCMethod,
    operation: (client: PublicClient<Transport, Chain>) => Promise<T>,
  ): Promise<T> {
    const triedProviders: string[] = [];

    return this.retryPolicy.execute(async () => {
      const providerUrl = this.selectNextProvider(method, triedProviders);
      triedProviders.push(providerUrl);

      try {
        return await this.executeOnProvider(providerUrl, method, operation);
      } catch (error) {
        return this.handleProviderError(error, method, operation, triedProviders);
      }
    });
  }

  private selectNextProvider(method: RPCMethod, triedProviders: string[]): string {
    const providerUrl = this.providerSelector.selectProviderForMethod(method);

    if (!providerUrl) {
      throw new ProviderUnavailableError('all', 'No healthy providers available');
    }

    if (triedProviders.includes(providerUrl)) {
      const fallbackUrl = this.providerSelector.selectFallbackProvider(triedProviders);
      if (!fallbackUrl) {
        throw new ProviderUnavailableError('all', 'All providers exhausted');
      }
      return fallbackUrl;
    }

    return providerUrl;
  }

  private async handleProviderError<T>(
    error: unknown,
    method: RPCMethod,
    operation: (client: PublicClient<Transport, Chain>) => Promise<T>,
    triedProviders: string[],
  ): Promise<T> {
    const fallbackUrl = this.providerSelector.selectFallbackProvider(triedProviders);
    if (!fallbackUrl) {
      throw error;
    }

    triedProviders.push(fallbackUrl);
    const tracker = this.healthTrackers.get(fallbackUrl);
    tracker?.recordFailover();

    return this.executeOnProvider(fallbackUrl, method, operation);
  }

  private async executeOnProvider<T>(
    providerUrl: string,
    method: RPCMethod,
    operation: (client: PublicClient<Transport, Chain>) => Promise<T>,
  ): Promise<T> {
    const client = this.clients.get(providerUrl);
    if (!client) {
      throw new ProviderUnavailableError(providerUrl, 'Client not initialized');
    }

    const circuitBreaker = this.circuitBreakers.get(providerUrl);
    if (circuitBreaker && !circuitBreaker.canExecute()) {
      throw new ProviderUnavailableError(providerUrl, 'Circuit breaker open');
    }

    const rateLimiter = this.rateLimiters.get(providerUrl);
    if (rateLimiter) {
      await rateLimiter.waitForToken();
    }

    const tracker = this.healthTrackers.get(providerUrl);
    const startTime = Date.now();

    try {
      const result = await operation(client);
      const duration = Date.now() - startTime;

      if (tracker) {
        tracker.recordSuccess(duration);
        tracker.recordRequest({
          method,
          providerUrl,
          durationMs: duration,
          success: true,
          timestamp: Date.now(),
        });
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      if (tracker) {
        tracker.recordFailure();
        tracker.recordRequest({
          method,
          providerUrl,
          durationMs: duration,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        });
      }

      throw error;
    }
  }

  private getWebSocketManager(): WebSocketManager | null {
    // Prefer primary WebSocket
    const primaryUrl = this.config.websocket?.primary?.url;
    if (primaryUrl) {
      const manager = this.websocketManagers.get(primaryUrl);
      if (manager?.getIsConnected()) {
        return manager;
      }
    }

    // Fall back to secondary
    const secondaryUrl = this.config.websocket?.secondary?.url;
    if (secondaryUrl) {
      const manager = this.websocketManagers.get(secondaryUrl);
      if (manager?.getIsConnected()) {
        return manager;
      }
    }

    return null;
  }

  async connectWebSockets(): Promise<void> {
    for (const manager of this.websocketManagers.values()) {
      try {
        await manager.connect();
      } catch (_error) {
        // Log error but don't throw - WebSocket is optional
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    for (const manager of this.websocketManagers.values()) {
      await manager.disconnect();
    }
  }

  getProviderHealth(providerUrl: string) {
    const tracker = this.healthTrackers.get(providerUrl);
    return tracker?.getHealth() ?? null;
  }

  getProviderMetrics(providerUrl: string) {
    const tracker = this.healthTrackers.get(providerUrl);
    return tracker?.getMetrics() ?? null;
  }

  getAllProviderHealth(): Record<string, ProviderHealth> {
    const health: Record<string, ProviderHealth> = {};
    for (const [url, tracker] of this.healthTrackers.entries()) {
      health[url] = tracker.getHealth();
    }
    return health;
  }

  getBlockLag(providerUrl: string): number {
    return this.blockLagMonitor.getLag(providerUrl);
  }

  getProviderRanking() {
    return this.providerSelector.getProviderRanking();
  }
}

export function calculateSerializedTransactionHash(signedTransaction: Hex): Hash {
  return keccak256(signedTransaction);
}
