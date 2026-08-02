import { describe, expect, it } from 'vitest';
import type { DiscoveryItem } from '../app/discovery-table';
import { mergeRanked } from './use-live';

const keyOf = (item: DiscoveryItem) => item.address.toLowerCase();

function token(address: string, overrides: Partial<DiscoveryItem> = {}): DiscoveryItem {
  return {
    address,
    name: null,
    symbol: null,
    priceRaw: null,
    priceDecimals: null,
    liquidityRaw: null,
    liquidityDecimals: null,
    liquidityChangeBps: null,
    volumeRaw: null,
    holderCount: null,
    firstSeenAt: null,
    primaryPoolAddress: null,
    riskCompletenessBps: null,
    projectVerified: false,
    ...overrides,
  };
}

describe('mergeRanked', () => {
  it('prepends brand-new entries in their ranked feed order', () => {
    const current = [token('0x0000000000000000000000000000000000000001')];
    const fresh = [
      token('0x0000000000000000000000000000000000000002'),
      token('0x0000000000000000000000000000000000000003'),
      token('0x0000000000000000000000000000000000000001'),
    ];
    expect(mergeRanked(current, fresh, keyOf, 100).map((item) => item.address)).toEqual([
      '0x0000000000000000000000000000000000000002',
      '0x0000000000000000000000000000000000000003',
      '0x0000000000000000000000000000000000000001',
    ]);
  });

  it('refreshes metrics in place for rows that are still listed', () => {
    const address = '0x0000000000000000000000000000000000000001';
    const current = [token(address, { liquidityRaw: '100' })];
    const fresh = [token(address, { liquidityRaw: '999' })];
    expect(mergeRanked(current, fresh, keyOf, 100)[0]?.liquidityRaw).toBe('999');
  });

  it('drops rows that ranked out of the fresh feed', () => {
    const address = '0x0000000000000000000000000000000000000001';
    const current = [token(address), token('0x0000000000000000000000000000000000000002')];
    const fresh = [token('0x0000000000000000000000000000000000000002')];
    expect(mergeRanked(current, fresh, keyOf, 100).map((item) => item.address)).toEqual([
      '0x0000000000000000000000000000000000000002',
    ]);
  });

  it('returns the fresh feed unchanged when nothing is on screen', () => {
    const fresh = [token('0x0000000000000000000000000000000000000001')];
    expect(mergeRanked([], fresh, keyOf, 100)).toEqual(fresh);
  });

  it('caps the merged list at the given limit', () => {
    const fresh = Array.from({ length: 150 }, (_, i) =>
      token(`0x${i.toString(16).padStart(64, '0')}`),
    );
    expect(mergeRanked([], fresh, keyOf, 100)).toHaveLength(100);
  });

  it('keeps last-good rows when a poll comes back empty', () => {
    const current = [token('0x0000000000000000000000000000000000000001')];
    expect(mergeRanked(current, [], keyOf, 100)).toEqual(current);
  });
});
