import { describe, expect, it } from 'vitest';
import { serializeRisk } from '../routes/intelligence.js';

/**
 * Blocker 4 requires that risk scores stay unexposed while the ruleset covers only part
 * of the declared RISK_CATEGORIES. A scan reports `complete` once every rule that exists
 * has run, so an unfinished ruleset still yields a grade. These tests pin the gate that
 * keeps that grade off a public response until the blocker closes.
 */

const BLOCK_HASH = `0x${'ab'.repeat(32)}`;

function report() {
  return {
    status: 'available' as const,
    scan: {
      id: 'scan-1',
      targetType: 'token',
      engineVersion: '1.0.0',
      rulesetVersion: '1.0.0',
      methodologyVersion: '1.0.0',
      sourceBlock: 100n,
      sourceBlockHash: BLOCK_HASH,
      completedAt: new Date('2026-07-16T00:00:00.000Z'),
    },
    score: {
      score: 10_000,
      grade: 'A',
      categoryScores: { Liquidity: 10_000 },
      completenessPercent: 100,
      unresolvedDataWarnings: [],
      completenessDetail: { totalRules: 16, evaluatedRules: 16 },
    },
    findings: [],
  } as unknown as Parameters<typeof serializeRisk>[0];
}

describe('risk score exposure gate', () => {
  it('omits score and grade when risk scores are disabled', () => {
    const output = serializeRisk(report(), false);

    expect(output.score).toBeNull();
    expect(JSON.stringify(output)).not.toContain('"grade"');
    expect(output.scoreStatus).toBe('WITHHELD_PENDING_RULE_COVERAGE');
  });

  it('still reports the evidence surface when scores are withheld', () => {
    const output = serializeRisk(report(), false);

    expect(output.status).toBe('available');
    expect(output.findings).toEqual([]);
    expect(output.sourceBlockHash).toBe(BLOCK_HASH);
  });

  it('exposes score and grade once the gate is enabled', () => {
    const output = serializeRisk(report(), true);

    expect(output.score).toMatchObject({ value: 10_000, grade: 'A' });
    expect(output.scoreStatus).toBeUndefined();
  });

  it('never leaks a grade for an unavailable scan regardless of the gate', () => {
    const unavailable = { status: 'unavailable', reason: 'NO_COMPLETED_SCAN' } as Parameters<
      typeof serializeRisk
    >[0];

    expect(JSON.stringify(serializeRisk(unavailable, true))).not.toContain('"grade"');
    expect(JSON.stringify(serializeRisk(unavailable, false))).not.toContain('"grade"');
  });
});
