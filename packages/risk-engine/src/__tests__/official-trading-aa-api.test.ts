import { describe, expect, it, vi } from 'vitest';
import { isOfficialSentry } from '../official-sentry.js';
import { validateQuote } from '../quote-trading.js';
import { authorizeSponsorship } from '../account-abstraction.js';
import { createApiKey, verifyApiKey } from '../api-customer.js';
describe('official token trading sponsorship api', () => {
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
      codeHash: ('0x' + '1'.repeat(64)) as `0x${string}`,
      name: 'Sentry',
      symbol: 'SENTRY',
      decimals: 18,
      supply: 1n,
      graduated: false,
      officialState: 'verified' as const,
    };
    expect(isOfficialSentry(1, r.address, r)).toBe(true);
  });
  it('rejects high-impact or failed quotes', async () => {
    const q = {
      quoteId: 'q',
      provider: 'p',
      chainId: 1,
      route: [],
      input: '0x1111111111111111111111111111111111111111' as const,
      output: '0x2222222222222222222222222222222222222222' as const,
      amountIn: 1n,
      expectedOut: 2n,
      minimumOut: 1n,
      fee: 0n,
      priceImpactBps: 1n,
      gas: 1n,
      deadline: 100,
      sourceBlock: 1n,
      expiresAt: 90,
      target: '0x3333333333333333333333333333333333333333' as const,
      selector: '0xa9059cbb' as const,
      calldata: '0xa9059cbb' as `0x${string}`,
      warnings: [],
    };
    await expect(
      validateQuote(
        q,
        {
          chainId: 1,
          targetAllowed: () => true,
          selectorAllowed: () => true,
          spenderAllowed: () => true,
          simulate: vi.fn(async () => false),
        },
        1,
      ),
    ).rejects.toThrow();
  });
  it('enforces sponsorship and hashes API secrets', () => {
    expect(() =>
      authorizeSponsorship(
        {
          sender: '0x1111111111111111111111111111111111111111',
          target: '0x2222222222222222222222222222222222222222',
          selector: '0xa9059cbb',
          callData: '0x',
          value: 1n,
          gas: 1n,
          nonce: 1n,
        },
        {
          enabled: true,
          chainId: 1,
          senders: [],
          targets: [],
          selectors: [],
          maxAmount: 1n,
          maxGas: 1n,
          dailyBudget: 1n,
          globalBudget: 1n,
          featureFlag: 'x',
        },
        0n,
        0n,
      ),
    ).toThrow();
    const k = createApiKey(['tokens:read'], 10);
    expect(verifyApiKey(k.secret, k.key)).toBe(true);
  });
});
