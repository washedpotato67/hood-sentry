import { isAddress } from 'viem';
import type { DiscoveryItem, SearchResult } from './types.js';

function normalized(value: string | null): string {
  return value?.trim().toLowerCase() ?? '';
}

function addressFields(item: DiscoveryItem): readonly [string, string][] {
  return [
    ['address', item.address],
    ['poolAddress', item.primaryPoolAddress ?? ''],
    ['deployerAddress', item.deployerAddress ?? ''],
    ...item.poolAddresses.map((address): [string, string] => ['poolAddress', address]),
    ...item.relatedWalletAddresses.map((address): [string, string] => ['walletAddress', address]),
  ];
}

function textFields(item: DiscoveryItem): readonly [string, string][] {
  return [
    ['canonicalTicker', normalized(item.canonicalTicker)],
    ['symbol', normalized(item.symbol)],
    ['projectSlug', normalized(item.projectSlug)],
    ['name', normalized(item.name)],
    ['projectName', normalized(item.projectName)],
    ['launchpad', normalized(item.launchpadKey)],
  ];
}

function textRank(field: string, value: string, query: string): number {
  if (value.length === 0) return 0;
  if (value === query) return field === 'canonicalTicker' ? 80_000 : 70_000;
  if (value.startsWith(query)) return 50_000;
  return value.includes(query) ? 30_000 : 0;
}

function matchItem(item: DiscoveryItem, query: string, exactAddress: boolean): SearchResult | null {
  const addressMatches = addressFields(item).filter(([, value]) => value.toLowerCase() === query);
  const rankedText = textFields(item)
    .map(([field, value]) => ({ field, rank: textRank(field, value, query) }))
    .filter(({ rank }) => rank > 0);
  const addressRank = addressMatches.length > 0 ? (exactAddress ? 100_000 : 90_000) : 0;
  const textMatchRank = rankedText.reduce((highest, match) => Math.max(highest, match.rank), 0);
  const rank = Math.max(addressRank, textMatchRank);
  if (rank === 0) return null;
  return {
    item,
    rank,
    matchedFields: [
      ...new Set([
        ...addressMatches.map(([field]) => field),
        ...rankedText.map(({ field }) => field),
      ]),
    ],
    duplicateSymbolWarning: item.duplicateSymbolAddresses.length > 0,
    duplicateSymbolAddresses: item.duplicateSymbolAddresses,
  };
}

export function searchDiscovery(items: readonly DiscoveryItem[], input: string): SearchResult[] {
  const query = input.trim().toLowerCase();
  if (query.length === 0) return [];
  const exactAddress = isAddress(input.trim());
  const results = items
    .map((item) => matchItem(item, query, exactAddress))
    .filter((result): result is SearchResult => result !== null);
  return results.sort(
    (left, right) =>
      right.rank - left.rank ||
      left.item.address.toLowerCase().localeCompare(right.item.address.toLowerCase()),
  );
}
