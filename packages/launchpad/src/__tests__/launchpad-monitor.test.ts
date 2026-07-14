import { describe, expect, it } from 'vitest';
import { checkLaunchpadDependencies } from '../launchpad-monitor.js';
describe('launchpad dependency monitor', () => {
  it('blocks unverified and changed dependencies', () => {
    const r = checkLaunchpadDependencies(
      [
        {
          role: 'factory',
          address: '0x1111111111111111111111111111111111111111',
          bytecodeHash: `0x${'1'.repeat(64)}` as `0x${string}`,
          verified: true,
          mutable: true,
        },
        {
          role: 'curve',
          address: '0x2222222222222222222222222222222222222222',
          bytecodeHash: `0x${'2'.repeat(64)}` as `0x${string}`,
          verified: false,
          mutable: false,
        },
      ],
      new Map([
        ['0x1111111111111111111111111111111111111111', `0x${'3'.repeat(64)}` as `0x${string}`],
      ]),
    );
    expect(r[0]?.status).toBe('blocked');
    expect(r[1]?.status).toBe('blocked');
  });
});
