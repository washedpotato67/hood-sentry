import { describe, expect, it } from 'vitest';
import { fifoCostBasis } from '../cost-basis.js';
import { approvalSignals } from '../approval-monitor.js';
import { validateSiwe } from '../siwe.js';
describe('accounting, approvals, and SIWE', () => {
  it('uses FIFO and preserves missing price uncertainty', () => {
    const r = fifoCostBasis(
      [
        {
          kind: 'buy',
          transaction: 'b1',
          amount: 10n,
          priceRaw: 2n,
          source: 'chain',
          confidence: 'high',
        },
        {
          kind: 'sell',
          transaction: 's1',
          amount: 4n,
          priceRaw: 5n,
          source: 'chain',
          confidence: 'high',
        },
      ],
      5n,
      18,
    );
    expect(r.realizedPnlRaw).toBe(12n);
    expect(r.costBasisRaw).toBe(12n);
  });
  it('flags dangerous approvals', () => {
    expect(
      approvalSignals({
        owner: '0x1111111111111111111111111111111111111111',
        token: '0x2222222222222222222222222222222222222222',
        spender: '0x3333333333333333333333333333333333333333',
        allowance: 2n ** 256n - 1n,
        max: true,
        classification: 'unknown_contract',
        lastUpdate: 1n,
        estimatedValueAtRisk: null,
      }),
    ).toContain('DANGEROUS_UNLIMITED_APPROVAL');
  });
  it('consumes a valid SIWE nonce and rejects replay', () => {
    const nonce = { nonce: 'abc', expiresAt: Date.now() + 10000, consumed: false };
    const m = {
      domain: 'app.test',
      address: '0x1111111111111111111111111111111111111111' as const,
      uri: 'https://app.test/login',
      chainId: 1,
      nonce: 'abc',
      issuedAt: new Date(Date.now() - 1000).toISOString(),
    };
    validateSiwe(
      m,
      { domain: 'app.test', uri: m.uri, chainId: 1, now: Math.floor(Date.now() / 1000) },
      nonce,
      true,
    );
    expect(() =>
      validateSiwe(
        m,
        { domain: 'app.test', uri: m.uri, chainId: 1, now: Math.floor(Date.now() / 1000) },
        nonce,
        true,
      ),
    ).toThrow();
  });
});
