import { describe, expect, it } from 'vitest';
import { scoreRisk } from '../deterministic-score.js';
import { validateOracle } from '../oracle-adapters.js';
import { analyzePortfolio } from '../portfolio-analysis.js';
import { adjustedBalance, validateCanonical } from '../stock-tokens.js';
describe('deterministic scoring and asset analysis', () => {
  it('scores deterministically and explains changes', () => {
    const a = scoreRisk(
      [
        {
          id: 'mint',
          category: 'contractControl',
          penalty: 10n,
          confidence: 'high',
          explanation: 'mint',
        },
      ],
      10000n,
      'v1',
    );
    const b = scoreRisk(
      [
        {
          id: 'mint',
          category: 'contractControl',
          penalty: 20n,
          confidence: 'high',
          explanation: 'mint',
        },
      ],
      10000n,
      'v1',
      a,
    );
    expect(a.grade).toBe('A');
    expect(b.changes).toContain('contractControl changed');
  });
  it('returns U for incomplete data', () => {
    expect(scoreRisk([], 5000n, 'v1').grade).toBe('U');
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
  it('keeps stock units distinct and rejects fake tickers', () => {
    const asset = {
      address: '0x3333333333333333333333333333333333333333',
      chainId: 1,
      category: 'stock' as const,
      underlyingTicker: 'ABC',
      source: 'official',
      rawBalance: 2n,
      decimals: 18,
      uiMultiplier: 3n,
      multiplierDecimals: 0,
      priceRaw: 10n,
      priceDecimals: 0,
      oracleStatus: 'available',
      sourceBlock: 1n,
    } as const;
    validateCanonical(asset, [asset]);
    expect(adjustedBalance(asset)).toBe(6n);
    expect(() =>
      validateCanonical({ ...asset, address: '0x4444444444444444444444444444444444444444' }, [
        asset,
      ]),
    ).toThrow();
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
