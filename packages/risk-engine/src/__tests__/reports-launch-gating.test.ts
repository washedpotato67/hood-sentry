import { describe, expect, it } from 'vitest';
import { transitionReport } from '../community-reports.js';
import { evaluateLaunchpad } from '../launchpad-evaluation.js';
import { calculateTier, reconcileEntitlement } from '../token-gating.js';
describe('reports launch review and token gating', () => {
  it('keeps final reports immutable', () => {
    const r = {
      id: 'r',
      reporter: 'u',
      subject: 'token' as const,
      subjectId: 't',
      reason: 'phishing' as const,
      description: 'x',
      evidence: [],
      evidenceHash: 'h',
      links: [],
      timestamp: 'now',
      status: 'SUBMITTED' as const,
      history: [],
    };
    const f = transitionReport(r, 'FINAL', 'm', 'review');
    expect(() => transitionReport(f, 'REJECTED', 'm', 'x')).toThrow();
  });
  it('rejects unverified launchpad contracts', () => {
    const r = evaluateLaunchpad({
      name: 'x',
      officialSite: 'https://x',
      socials: [],
      contracts: [
        {
          chainId: 1,
          address: '0x1111111111111111111111111111111111111111',
          role: 'factory',
          officialSource: 'x',
          explorerVerified: false,
          runtimeBytecodeHash: `0x${'1'.repeat(64)}` as `0x${string}`,
          verifiedAt: 'now',
        },
      ],
      unknowns: [],
    });
    expect(r.goNoGo).toBe('no_go');
  });
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
