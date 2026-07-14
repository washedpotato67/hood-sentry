export type BlockscoutCacheStatus = 'miss' | 'fresh' | 'refreshed' | 'stale';

export type BlockscoutWarningCode =
  | 'ABI_MALFORMED'
  | 'PROVIDER_UNAVAILABLE'
  | 'RAW_RESPONSE_TOO_LARGE';

export interface BlockscoutWarning {
  code: BlockscoutWarningCode;
  message: string;
  provider: 'blockscout';
}

export interface BlockscoutSourceFile {
  path: string;
  source: string;
}

export interface BlockscoutAbiParameter {
  name?: string;
  type: string;
  internalType?: string;
  indexed?: boolean;
  components?: BlockscoutAbiParameter[];
}

export interface BlockscoutAbiItem {
  type: 'constructor' | 'error' | 'event' | 'fallback' | 'function' | 'receive';
  name?: string;
  stateMutability?: 'pure' | 'view' | 'nonpayable' | 'payable';
  anonymous?: boolean;
  inputs?: BlockscoutAbiParameter[];
  outputs?: BlockscoutAbiParameter[];
}

export interface BlockscoutProxyMetadata {
  proxyType: string | null;
  implementationAddresses: string[];
  adminAddress: string | null;
  minimalProxyAddress: string | null;
}

export interface BlockscoutTokenLabels {
  name: string | null;
  symbol: string | null;
  publicTags: string[];
}

export interface BlockscoutProvenance {
  provider: 'blockscout';
  providerUrl: string;
  endpoints: string[];
  fetchedAt: string;
}

export interface BlockscoutContractMetadata {
  chainId: number;
  address: string;
  verified: boolean;
  verificationStatus: 'fully_verified' | 'partially_verified' | 'verified' | 'unverified';
  sourceFiles: BlockscoutSourceFile[];
  sourceHash: string | null;
  abi: BlockscoutAbiItem[] | null;
  compilerVersion: string | null;
  optimizerEnabled: boolean | null;
  optimizerRuns: number | null;
  compilerSettings: Record<string, unknown> | null;
  constructorArguments: string | null;
  contractName: string | null;
  proxy: BlockscoutProxyMetadata;
  tokenLabels: BlockscoutTokenLabels;
  rawResponse: Record<string, unknown>;
  provenance: BlockscoutProvenance;
}

export interface BlockscoutEnrichmentResult {
  status: 'available' | 'unavailable';
  metadata: BlockscoutContractMetadata | null;
  warnings: BlockscoutWarning[];
  cacheStatus: BlockscoutCacheStatus;
}

export interface BlockscoutCacheEntry {
  result: BlockscoutEnrichmentResult;
  expiresAt: string;
}

export interface BlockscoutCache {
  get(key: string): Promise<BlockscoutCacheEntry | null>;
  set(key: string, entry: BlockscoutCacheEntry): Promise<void>;
}

export type BlockscoutCacheEntryParser = (value: unknown) => BlockscoutCacheEntry;

export interface BlockscoutRateLimitGate {
  acquire(): Promise<void>;
}

export interface BlockscoutClientOptions {
  apiBaseUrl: string;
  cache?: BlockscoutCache;
  cacheTtlMs?: number;
  fetch?: typeof globalThis.fetch;
  maxAttempts?: number;
  maxRawResponseBytes?: number;
  now?: () => Date;
  requestsPerSecond?: number;
  retryBaseDelayMs?: number;
  rateLimitGate?: BlockscoutRateLimitGate;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
}

export interface ChainProxyState {
  implementationAddress: string | null;
  adminAddress: string | null;
}

export interface ExplorerConflict {
  field: 'implementation_address' | 'admin_address';
  chainValue: string | null;
  explorerValue: string | null;
  provider: 'blockscout';
  fetchedAt: string;
}

export interface DataQualityWarning {
  category: 'explorer_chain_conflict';
  severity: 'warning';
  message: string;
  conflict: ExplorerConflict;
}

export interface ReconciledProxyMetadata {
  current: ChainProxyState;
  explorer: BlockscoutProxyMetadata;
  conflicts: ExplorerConflict[];
  dataQualityWarnings: DataQualityWarning[];
}
