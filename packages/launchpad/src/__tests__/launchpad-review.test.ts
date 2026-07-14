import { describe, expect, it } from 'vitest';
import { evaluateLaunchpad } from '../launchpad-evaluation.js';
import { isOfficialSentry } from '../official-sentry.js';
describe('launchpad review and official identity', () => {
  it('uses chain and address for official identity', () => {
    const r = {
      chainId: 1,
      address: '0x1111111111111111111111111111111111111111' as const,
      creationTransaction:
        '0x2222222222222222222222222222222222222222222222222222222222222222' as const,
      creationBlock: 1n,
      creator: '0x3333333333333333333333333333333333333333' as const,
      launchpad: '0x4444444444444444444444444444444444444444' as const,
      factory: '0x5555555555555555555555555555555555555555' as const,
      curve: '0x6666666666666666666666666666666666666666' as const,
      codeHash: `0x${'1'.repeat(64)}` as `0x${string}`,
      name: 'Sentry',
      symbol: 'SENTRY',
      decimals: 18,
      supply: 1n,
      graduated: false,
      officialState: 'verified' as const,
    };
    expect(isOfficialSentry(1, r.address, r)).toBe(true);
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
});
