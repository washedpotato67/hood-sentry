import type { Address } from 'viem';

export const MAINNET_CHAIN_ID = 4663 as const;
export const TESTNET_CHAIN_ID = 46630 as const;
export const SUPPORTED_CHAIN_IDS = [MAINNET_CHAIN_ID, TESTNET_CHAIN_ID] as const;

export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

export function isSupportedChainId(chainId: number): chainId is SupportedChainId {
  return SUPPORTED_CHAIN_IDS.includes(chainId as SupportedChainId);
}

export interface RegistryEntry {
  name: string;
  key: string;
  chainId: SupportedChainId;
  address: Address;
  role: string;
  officialSource: string;
  verificationDate: string;
  runtimeBytecodeHash: string | null;
  enabled: boolean;
  notes: string;
}

export interface RegistryVersion {
  version: string;
  createdAt: string;
}

export interface Registry<T extends RegistryEntry = RegistryEntry> {
  name: string;
  version: RegistryVersion;
  entries: ReadonlyArray<T>;
}

export interface NetworkConfig {
  chainId: SupportedChainId;
  name: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  publicRpcUrl: string;
  managedRpcUrl?: string;
  publicWsUrl?: string;
  managedWsUrl?: string;
  explorerUrl: string;
  explorerApiUrl?: string;
  isTestnet: boolean;
}

export interface CanonicalAssetEntry extends RegistryEntry {
  symbol: string;
  decimals: number;
  category: 'native' | 'wrapped' | 'stablecoin' | 'utility';
}

export interface StockTokenEntry extends RegistryEntry {
  ticker: string;
  assetType: 'stock' | 'etf';
}

export interface ApplicationContractEntry extends RegistryEntry {
  contractType:
    | 'token'
    | 'staking'
    | 'registry'
    | 'bond-vault'
    | 'report-registry'
    | 'timelock'
    | 'safe'
    | 'vesting'
    | 'distribution-vault';
}

export interface DexContractEntry extends RegistryEntry {
  protocol: string;
  dexType: 'factory' | 'router' | 'quoter' | 'pool' | 'permit2' | 'position-manager';
}

export interface QuoteProviderEntry extends RegistryEntry {
  provider: string;
  quoteType: 'aggregator' | 'rfq' | 'amm';
}

export interface ChainlinkFeedEntry extends RegistryEntry {
  feedType: 'price' | 'sequencer-uptime';
  base?: string;
  quote?: string;
  heartbeatSeconds?: number;
  decimals?: number;
}

export interface SmartAccountEntry extends RegistryEntry {
  provider: string;
  accountType: 'entrypoint' | 'paymaster' | 'bundler' | 'factory';
}

export interface BridgeEntry extends RegistryEntry {
  bridgeType: 'canonical' | 'third-party';
  direction: 'deposit' | 'withdrawal' | 'both';
}
