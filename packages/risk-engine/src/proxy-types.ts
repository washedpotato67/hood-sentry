import type { Address, Hash, Hex } from 'viem';

export type ProxyKind =
  | 'transparent'
  | 'uups'
  | 'beacon'
  | 'minimal_clone'
  | 'diamond'
  | 'unknown_delegatecall'
  | 'none'
  | 'unknown';

export type AuthorityKind = 'eoa' | 'safe' | 'timelock' | 'contract' | 'renounced' | 'unknown';

export interface ProxyReadLog {
  readonly address: Address;
  readonly blockNumber: bigint | null;
  readonly blockHash: Hash | null;
  readonly transactionHash: Hash | null;
  readonly logIndex: number | null;
  readonly topics: readonly Hex[];
  readonly data: Hex;
}

export interface ProxyAnalysisClient {
  getCode(address: Address, blockNumber?: bigint): Promise<Hex>;
  getStorageAt(address: Address, slot: Hash, blockNumber?: bigint): Promise<Hex>;
  call(params: { to: Address; data: Hex; blockNumber?: bigint }): Promise<Hex>;
  getLogs(params: {
    address?: Address | Address[];
    fromBlock?: bigint;
    toBlock?: bigint;
    topics?: (Hex | Hex[] | null)[];
  }): Promise<readonly ProxyReadLog[]>;
}

export interface ExplorerProxyClaim {
  readonly provider: string;
  readonly fetchedAt: string;
  readonly proxyType: string | null;
  readonly implementationAddresses: readonly string[];
  readonly adminAddress: string | null;
  readonly beaconAddress?: string | null;
}

export interface SourceVerificationClaim {
  readonly address: Address;
  readonly verified: boolean;
  readonly provider: string;
  readonly fetchedAt: string;
  readonly sourceHash: Hex | null;
}

export interface InitializationEvidence {
  readonly proxyInitialized: boolean | null;
  readonly exposedInitializer: boolean;
  readonly implementationInitializersDisabled: boolean | null;
  readonly storageSlot: Hash | null;
  readonly storageValue: Hex | null;
  readonly provenanceKey: string;
}

export interface ProxyAnalysisInput {
  readonly chainId: number;
  readonly address: Address;
  readonly sourceBlock: bigint;
  readonly sourceBlockHash: Hash;
  readonly recentUpgradeWindowBlocks?: bigint;
  readonly maxNestedDepth?: number;
  readonly explorer?: ExplorerProxyClaim;
  readonly sourceVerification?: readonly SourceVerificationClaim[];
  readonly initialization?: InitializationEvidence;
  readonly cloneFactoryAddress?: Address;
}

export interface StorageSlotEvidence {
  readonly slot: Hash;
  readonly rawValue: Hex;
  readonly resolvedAddress: Address | null;
}

export interface AddressAuthority {
  readonly address: Address | null;
  readonly kind: AuthorityKind;
  readonly ownerAddress: Address | null;
  readonly safeThreshold: bigint | null;
  readonly safeOwners: readonly Address[];
  readonly timelockDelaySeconds: bigint | null;
  readonly hasCode: boolean | null;
  readonly evidence: readonly string[];
}

export interface UpgradeEventEvidence {
  readonly kind: 'implementation' | 'admin' | 'beacon' | 'diamond';
  readonly blockNumber: bigint;
  readonly blockHash: Hash;
  readonly transactionHash: Hash;
  readonly logIndex: number;
  readonly topic0: Hex;
}

export interface ProxyMetadataConflict {
  readonly field: 'proxy_type' | 'implementation_address' | 'admin_address' | 'beacon_address';
  readonly chainValue: string | null;
  readonly explorerValue: string | null;
  readonly provider: string;
  readonly fetchedAt: string;
}

export interface ProxyLayer {
  readonly depth: number;
  readonly proxyAddress: Address;
  readonly kind: ProxyKind;
  readonly runtimeCodeHash: Hex;
  readonly implementationAddress: Address | null;
  readonly implementationCodeHash: Hex | null;
  readonly beaconAddress: Address | null;
  readonly adminAddress: Address | null;
  readonly implementationSlot: StorageSlotEvidence;
  readonly adminSlot: StorageSlotEvidence;
  readonly beaconSlot: StorageSlotEvidence;
  readonly minimalCloneFactoryAddress: Address | null;
  readonly indicators: readonly string[];
}

export type ProxyFindingCode =
  | 'UPGRADEABLE_CONTRACT'
  | 'EOA_CONTROLLED_UPGRADES'
  | 'NO_TIMELOCK'
  | 'UNVERIFIED_IMPLEMENTATION'
  | 'IMPLEMENTATION_WITHOUT_CODE'
  | 'RECENT_IMPLEMENTATION_CHANGE'
  | 'UNINITIALIZED_PROXY'
  | 'EXPOSED_INITIALIZER'
  | 'IMPLEMENTATION_INITIALIZER_NOT_DISABLED'
  | 'SUSPICIOUS_DELEGATECALL'
  | 'NESTED_PROXY_COMPLEXITY'
  | 'PROXY_METADATA_DISAGREEMENT';

export interface ProxyAnalysisFinding {
  readonly code: ProxyFindingCode;
  readonly status: 'warning' | 'fail' | 'unknown';
  readonly severity: 'low' | 'medium' | 'high';
  readonly confidence: 'low' | 'medium' | 'high' | 'confirmed';
  readonly summary: string;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface ProxyAnalysisResult {
  readonly chainId: number;
  readonly proxyAddress: Address;
  readonly sourceBlock: bigint;
  readonly sourceBlockHash: Hash;
  readonly proxyKind: ProxyKind;
  readonly implementationAddress: Address | null;
  readonly implementationCodeHash: Hex | null;
  readonly beaconAddress: Address | null;
  readonly adminAddress: Address | null;
  readonly upgradeAuthority: AddressAuthority;
  readonly currentOwner: Address | null;
  readonly layers: readonly ProxyLayer[];
  readonly recentUpgradeEvents: readonly UpgradeEventEvidence[];
  readonly sourceVerified: boolean | null;
  readonly implementationSourceVerified: boolean | null;
  readonly initialization: InitializationEvidence | null;
  readonly conflicts: readonly ProxyMetadataConflict[];
  readonly findings: readonly ProxyAnalysisFinding[];
  readonly warnings: readonly string[];
}
