import type { Address, Hash, Hex } from 'viem';

export interface ProviderConfig {
  url: string;
  type: 'http' | 'websocket';
  role: 'primary' | 'secondary' | 'archive';
  maxRetries?: number;
  timeout?: number;
  rateLimit?: {
    requestsPerSecond: number;
    burstSize?: number;
  };
}

export interface RPCClientConfig {
  chainId: number;
  primary: ProviderConfig;
  secondary?: ProviderConfig;
  archive?: ProviderConfig;
  websocket?: {
    primary?: ProviderConfig;
    secondary?: ProviderConfig;
  };
  healthCheck: {
    intervalMs: number;
    timeoutMs: number;
    maxBlockLag: number;
  };
  circuitBreaker: {
    failureThreshold: number;
    resetTimeoutMs: number;
    halfOpenMaxRequests: number;
  };
  retry: {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
  };
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  halfOpenAttempts: number;
}

export interface ProviderHealth {
  providerUrl: string;
  role: 'primary' | 'secondary' | 'archive';
  isHealthy: boolean;
  circuitState: CircuitState;
  latencyMs: number | null;
  lastBlockNumber: bigint | null;
  lastBlockHash: Hash | null;
  lastCheckTime: number;
  errorRate: number;
  consecutiveFailures: number;
  chainIdMatch: boolean;
  archiveCapable: boolean | null;
}

export interface BlockLagMetrics {
  providerUrl: string;
  currentBlock: bigint;
  expectedBlock: bigint;
  lag: number;
  timestamp: number;
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: Error) => boolean;
}

export interface RateLimiterConfig {
  requestsPerSecond: number;
  burstSize?: number;
}

export interface WebSocketSubscription {
  id: string;
  type: 'newHeads' | 'logs' | 'newPendingTransactions';
  callback: (data: unknown) => void;
  filter?: unknown;
}

export interface TransactionSimulationResult {
  success: boolean;
  gasUsed: bigint;
  returnValue: Hex;
  error?: string;
}

export interface MulticallRequest {
  target: Address;
  callData: Hex;
  allowFailure?: boolean;
}

export interface MulticallResult {
  success: boolean;
  returnData: Hex;
  gasUsed: bigint;
}

export interface GasEstimate {
  gasLimit: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  gasPrice?: bigint;
}

export interface FeeEstimate {
  baseFee: bigint;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gasPrice: bigint;
}

export type RPCMethod =
  | 'eth_blockNumber'
  | 'eth_getBlockByNumber'
  | 'eth_getBlockByHash'
  | 'eth_getTransactionByHash'
  | 'eth_getTransactionReceipt'
  | 'eth_getLogs'
  | 'eth_getCode'
  | 'eth_getStorageAt'
  | 'eth_call'
  | 'eth_estimateGas'
  | 'eth_gasPrice'
  | 'eth_maxPriorityFeePerGas'
  | 'eth_chainId'
  | 'eth_sendRawTransaction'
  | 'eth_simulateV1';

export interface RPCRequestMetrics {
  method: RPCMethod;
  providerUrl: string;
  durationMs: number;
  success: boolean;
  error?: string;
  timestamp: number;
}

export interface ProviderMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  errorRate: number;
  circuitBreakerTrips: number;
  failovers: number;
  lastUpdated: number;
}

export class RPCError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly providerUrl?: string,
    public readonly method?: RPCMethod,
    public readonly isRetryable: boolean = true,
  ) {
    super(message);
    this.name = 'RPCError';
  }
}

export class ProviderUnavailableError extends RPCError {
  constructor(providerUrl: string, reason: string) {
    super(
      `Provider ${providerUrl} unavailable: ${reason}`,
      'PROVIDER_UNAVAILABLE',
      providerUrl,
      undefined,
      false,
    );
    this.name = 'ProviderUnavailableError';
  }
}

export class ChainMismatchError extends RPCError {
  constructor(expectedChainId: number, actualChainId: number, providerUrl: string) {
    super(
      `Chain ID mismatch: expected ${expectedChainId}, got ${actualChainId}`,
      'CHAIN_MISMATCH',
      providerUrl,
      'eth_chainId',
      false,
    );
    this.name = 'ChainMismatchError';
  }
}

export class RateLimitError extends RPCError {
  constructor(providerUrl: string, retryAfterMs?: number) {
    super(`Rate limit exceeded for ${providerUrl}`, 'RATE_LIMIT', providerUrl, undefined, true);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }

  public readonly retryAfterMs?: number;
}

export class TimeoutError extends RPCError {
  constructor(providerUrl: string, method: RPCMethod, timeoutMs: number) {
    super(
      `Request timeout after ${timeoutMs}ms for ${method}`,
      'TIMEOUT',
      providerUrl,
      method,
      true,
    );
    this.name = 'TimeoutError';
  }
}

export class ContractRevertError extends RPCError {
  constructor(providerUrl: string, reason: string, data?: Hex) {
    super(
      `Contract reverted: ${reason}`,
      'CONTRACT_REVERT',
      providerUrl,
      'eth_call',
      false, // Not retryable - deterministic failure
    );
    this.name = 'ContractRevertError';
    this.reason = reason;
    this.data = data;
  }

  public readonly reason: string;
  public readonly data?: Hex;
}
