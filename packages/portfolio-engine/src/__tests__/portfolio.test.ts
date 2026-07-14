import { describe, expect, it } from 'vitest';
import { approvalSignals } from '../approval-monitor.js';
import { fifoCostBasis } from '../cost-basis.js';
import { validateOracle } from '../oracle-adapters.js';
import { analyzePortfolio } from '../portfolio-analysis.js';
describe('portfolio: cost basis, approvals, oracle, and assets', () => {
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
  it('validates oracle freshness and failures', () => {
    const result = validateOracle(
      {
        feed: '0x2222222222222222222222222222222222222222',
        chainId: 1,
        rawAnswer: 100n,
        decimals: 8,
        round: 1n,
        updatedAt: 10n,
        observedAt: 10n,
        sourceBlock: 1n,
        status: 'available',
      },
      5n,
      20n,
    );
    expect(result.status).toBe('stale');
  });
  it('keeps missing prices while separating exact and estimated value', () => {
    const result = analyzePortfolio([
      {
        address: '0x5555555555555555555555555555555555555555',
        rawBalance: 10n,
        decimals: 0,
        priceRaw: 2n,
        priceDecimals: 0,
        exact: true,
        stale: false,
        criticalRisk: false,
      },
      {
        address: '0x6666666666666666666666666666666666666666',
        rawBalance: 1n,
        decimals: 0,
        priceRaw: null,
        priceDecimals: 0,
        exact: false,
        stale: true,
        criticalRisk: true,
      },
    ]);
    expect(result.exactValueRaw).toBe(20n);
    expect(result.unknownAssets).toHaveLength(1);
  });
});
