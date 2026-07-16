import { describe, expect, it } from 'vitest';
import { redactRiskScoring } from '../routes/discovery.js';

/**
 * The discovery feed carries riskGrade on every item and lets a caller filter by it. Gating the
 * token page alone would leave both open: /discovery/trending would still return the grade, and
 * ?riskGrades=A would still let anyone list the tokens the engine currently calls safe. The same
 * blocker 4 rule applies here, so scoring is stripped from the feed until coverage is complete.
 */

function item() {
  return {
    address: '0x1111111111111111111111111111111111111111',
    symbol: 'TEST',
    riskGrade: 'A',
    riskCompletenessBps: 10_000n,
    dataQualityWarnings: ['STALE'],
    lastScannedAt: '2026-07-16T00:00:00.000Z',
  };
}

describe('discovery risk scoring exposure', () => {
  it('strips grade and completeness from a feed item when scores are disabled', () => {
    const output = redactRiskScoring(item(), false) as Record<string, unknown>;

    expect(output.riskGrade).toBeUndefined();
    expect(output.riskCompletenessBps).toBeUndefined();
    expect(JSON.stringify(output)).not.toContain('riskGrade');
  });

  it('keeps non-scoring discovery fields intact', () => {
    const output = redactRiskScoring(item(), false) as Record<string, unknown>;

    expect(output.symbol).toBe('TEST');
    expect(output.dataQualityWarnings).toEqual(['STALE']);
    expect(output.lastScannedAt).toBe('2026-07-16T00:00:00.000Z');
  });

  it('preserves grade when scores are enabled', () => {
    const output = redactRiskScoring(item(), true) as Record<string, unknown>;

    expect(output.riskGrade).toBe('A');
  });

  it('redacts nested arrays of items', () => {
    const page = { items: [item(), item()], cursor: null };
    const output = redactRiskScoring(page, false);

    expect(JSON.stringify(output)).not.toContain('riskGrade');
    expect(JSON.stringify(output)).toContain('TEST');
  });
});
