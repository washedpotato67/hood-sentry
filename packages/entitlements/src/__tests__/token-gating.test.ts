import { describe, expect, it } from 'vitest';
import { calculateTier, reconcileEntitlement } from '../token-gating.js';
describe('token gating', () => {
  it('enforces server-side tier thresholds and cache', () => {
    const c = {
      tokenAddress: '0x1111111111111111111111111111111111111111' as const,
      chainId: 1,
      enabled: true,
      minimums: { free: 0n, scout: 10n, analyst: 20n, sentinel: 30n },
      cacheSeconds: 60,
      minimumHoldingSeconds: 0,
      version: 'v1',
    };
    expect(calculateTier(20n, c)).toBe('analyst');
    expect(
      reconcileEntitlement('0x2222222222222222222222222222222222222222', 0n, 1n, c, 100).expiresAt,
    ).toBe(60100);
  });
});
