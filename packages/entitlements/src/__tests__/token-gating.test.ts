import { describe, expect, it } from 'vitest';
import { advanceEntitlementState, calculateTier, reconcileEntitlement } from '../token-gating.js';
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

describe('holding duration', () => {
  it('waits before an upgrade and downgrades without delay', () => {
    const pending = advanceEntitlementState({
      current: null,
      eligibleTier: 'analyst',
      observedAt: 1_000,
      minimumHoldingSeconds: 60,
      resetCandidate: false,
    });
    expect(pending).toEqual({
      grantedTier: 'free',
      candidateTier: 'analyst',
      candidateSince: 1_000,
    });
    const granted = advanceEntitlementState({
      current: pending,
      eligibleTier: 'analyst',
      observedAt: 61_000,
      minimumHoldingSeconds: 60,
      resetCandidate: false,
    });
    expect(granted.grantedTier).toBe('analyst');
    expect(
      advanceEntitlementState({
        current: granted,
        eligibleTier: 'scout',
        observedAt: 62_000,
        minimumHoldingSeconds: 60,
        resetCandidate: false,
      }).grantedTier,
    ).toBe('scout');
  });

  it('restarts the clock after transfer activity', () => {
    const state = advanceEntitlementState({
      current: {
        grantedTier: 'free',
        candidateTier: 'scout',
        candidateSince: 1_000,
      },
      eligibleTier: 'scout',
      observedAt: 61_000,
      minimumHoldingSeconds: 60,
      resetCandidate: true,
    });
    expect(state).toMatchObject({ grantedTier: 'free', candidateSince: 61_000 });
  });
});
