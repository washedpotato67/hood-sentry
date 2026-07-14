import type { CanonicalAssetEntry, Registry } from '../types.js';
import { MAINNET_CHAIN_ID } from '../types.js';

const canonicalAssetEntries: ReadonlyArray<CanonicalAssetEntry> = [
  {
    name: 'Wrapped Ether',
    key: 'weth',
    chainId: MAINNET_CHAIN_ID,
    address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
    role: 'wrapped-native-token',
    officialSource: 'https://docs.robinhood.com/chain/connecting/',
    verificationDate: '2026-07-13',
    runtimeBytecodeHash: null,
    enabled: true,
    notes: 'Canonical WETH on Robinhood Chain mainnet',
    symbol: 'WETH',
    decimals: 18,
    category: 'wrapped',
  },
  {
    name: 'USDG',
    key: 'usdg',
    chainId: MAINNET_CHAIN_ID,
    address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
    role: 'stablecoin',
    officialSource: 'https://docs.robinhood.com/chain/connecting/',
    verificationDate: '2026-07-13',
    runtimeBytecodeHash: null,
    enabled: true,
    notes: 'Canonical USD-pegged stablecoin on Robinhood Chain mainnet',
    symbol: 'USDG',
    decimals: 18,
    category: 'stablecoin',
  },
] as const;

export const canonicalAssetRegistry: Registry<CanonicalAssetEntry> = {
  name: 'Canonical Assets',
  version: {
    version: '1.0.0',
    createdAt: '2026-07-13',
  },
  entries: canonicalAssetEntries,
};
