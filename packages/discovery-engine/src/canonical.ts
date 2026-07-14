import type { Address } from 'viem';
import type { DiscoveryCandidate } from './types.js';

export interface CanonicalTokenEntry {
  chainId: number;
  address: Address;
  ticker: string;
  name: string;
  assetType: 'stock' | 'etf';
  category: string | null;
}

export function applyCanonicalTokenRegistry(
  candidate: DiscoveryCandidate,
  entries: readonly CanonicalTokenEntry[],
): DiscoveryCandidate {
  const entry = entries.find(
    (item) =>
      item.chainId === candidate.chainId &&
      item.address.toLowerCase() === candidate.address.toLowerCase(),
  );
  if (entry === undefined) return candidate;
  return {
    ...candidate,
    name: candidate.name ?? entry.name,
    tokenType: entry.assetType === 'stock' ? 'stockToken' : 'etfToken',
    canonicalState: 'canonical',
    canonicalTicker: entry.ticker,
    stockTokenCategory: entry.assetType === 'stock' ? entry.category : null,
    etfCategory: entry.assetType === 'etf' ? entry.category : null,
  };
}
