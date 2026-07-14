import { isAddress, isHash } from 'viem';
import { z } from 'zod';
import type { DiscoveryItem, SponsoredPlacement } from './types.js';

const discoveryItemSchema = z.custom<DiscoveryItem>((value) => {
  if (typeof value !== 'object' || value === null) return false;
  const record = Object.fromEntries(Object.entries(value));
  const trending = record.trending;
  return (
    typeof record.chainId === 'number' &&
    typeof record.address === 'string' &&
    isAddress(record.address) &&
    typeof record.sourceBlockNumber === 'bigint' &&
    typeof record.sourceBlockHash === 'string' &&
    isHash(record.sourceBlockHash) &&
    typeof record.canonical === 'boolean' &&
    typeof trending === 'object' &&
    trending !== null &&
    typeof Object.fromEntries(Object.entries(trending)).scoreBps === 'bigint'
  );
}, 'Stored discovery item is malformed');

const sponsoredPlacementSchema = z.custom<SponsoredPlacement>((value) => {
  if (typeof value !== 'object' || value === null) return false;
  const record = Object.fromEntries(Object.entries(value));
  return (
    typeof record.placementId === 'string' &&
    typeof record.chainId === 'number' &&
    typeof record.tokenAddress === 'string' &&
    isAddress(record.tokenAddress) &&
    record.label === 'Sponsored'
  );
}, 'Stored sponsored placement is malformed');

function replacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? { $sentryBigint: value.toString() } : value;
}

function reviver(_key: string, value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const record = Object.fromEntries(Object.entries(value));
  if (Object.keys(record).length === 1 && typeof record.$sentryBigint === 'string') {
    return BigInt(record.$sentryBigint);
  }
  return value;
}

export function serializeDiscoveryItem(item: DiscoveryItem): string {
  return JSON.stringify(item, replacer);
}

export function parseDiscoveryItem(serialized: string): DiscoveryItem {
  const parsed: unknown = JSON.parse(serialized, reviver);
  return discoveryItemSchema.parse(parsed);
}

export function serializeSponsoredPlacement(placement: SponsoredPlacement): string {
  return JSON.stringify(placement, replacer);
}

export function parseSponsoredPlacement(serialized: string): SponsoredPlacement {
  const parsed: unknown = JSON.parse(serialized, reviver);
  return sponsoredPlacementSchema.parse(parsed);
}
