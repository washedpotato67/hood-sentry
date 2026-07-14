export {
  MAINNET_CHAIN_ID,
  TESTNET_CHAIN_ID,
  SUPPORTED_CHAIN_IDS,
  isSupportedChainId,
} from './types.js';
export type {
  SupportedChainId,
  RegistryEntry,
  RegistryVersion,
  Registry,
  NetworkConfig,
  CanonicalAssetEntry,
  StockTokenEntry,
  ApplicationContractEntry,
  DexContractEntry,
  QuoteProviderEntry,
  ChainlinkFeedEntry,
  SmartAccountEntry,
  BridgeEntry,
} from './types.js';

export { robinhoodMainnet, robinhoodTestnet, getChainDefinition } from './chains.js';

export { createChainClient, createWebSocketClient } from './clients.js';
export type { ChainClientOptions } from './clients.js';

export {
  validateRegistry,
  RegistryValidationError,
  checksumAddress,
  findEntry,
  findEntries,
  findEnabledEntries,
  getEntryByAddress,
  getEnabledEntries,
  getEntriesByChainId,
} from './registry.js';

export {
  networkRegistry,
  getNetworkConfig,
  getMainnetConfig,
  getTestnetConfig,
  canonicalAssetRegistry,
  stockTokenRegistry,
  applicationContractRegistry,
  PENDING_APPLICATION_CONTRACTS,
  dexRegistry,
  PENDING_DEX_CONTRACTS,
  quoteProviderRegistry,
  PENDING_QUOTE_PROVIDERS,
  chainlinkFeedRegistry,
  PENDING_CHAINLINK_FEEDS,
  sequencerFeedRegistry,
  PENDING_SEQUENCER_FEEDS,
  smartAccountRegistry,
  PENDING_SMART_ACCOUNT_INFRASTRUCTURE,
  bridgeRegistry,
  PENDING_BRIDGES,
} from './registries/index.js';

export {
  buildTransactionUrl,
  buildAddressUrl,
  buildBlockUrl,
  buildTokenUrl,
  getExplorerApiUrl,
} from './explorer.js';

export { selectRpcUrl, selectWsUrl, isPublicRpc } from './rpc.js';
export type { RpcSelectionOptions } from './rpc.js';

export {
  ChainMismatchError,
  UnsupportedChainError,
  MainnetWriteError,
  assertSupportedChain,
  validateChainId,
  verifyBytecode,
  assertMainnetWriteAllowed,
  guardWriteOperation,
} from './guards.js';

export { validateAllRegistries, assertRegistriesValid } from './validation.js';
export type { ValidationResult } from './validation.js';

// RPC Layer
export {
  RPCClient,
  CircuitBreaker,
  RetryPolicy,
  RateLimiter,
  ProviderHealthTracker,
  BlockLagMonitor,
  WebSocketManager,
  ProviderSelector,
} from './rpc/index.js';

export type {
  RPCClientConfig,
  ProviderConfig,
  CircuitBreakerConfig,
  RetryPolicyConfig,
  BlockLagMonitorConfig,
  WebSocketManagerConfig,
  ProviderSelectorConfig,
  ProviderHealth,
  ProviderMetrics,
  RPCMethod,
  TransactionSimulationResult,
  MulticallRequest,
  MulticallResult,
  GasEstimate,
  FeeEstimate,
  WebSocketSubscription,
  BlockLagMetrics,
  CircuitState,
  CircuitBreakerState,
  RateLimiterConfig,
  RetryOptions,
  RPCRequestMetrics,
} from './rpc/index.js';

export {
  RPCError,
  ProviderUnavailableError,
  ChainMismatchError as RPCChainMismatchError,
  RateLimitError,
  TimeoutError,
  ContractRevertError,
} from './rpc/index.js';
