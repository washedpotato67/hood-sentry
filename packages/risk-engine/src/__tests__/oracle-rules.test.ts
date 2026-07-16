import { describe, expect, it } from 'vitest';
import { createOracleRiskRules } from '../oracle-rules.js';
import { ORACLE_OBSERVATION_SOURCE, serializeOracleResult } from '../oracle-types.js';
import type { OracleBehaviorResult, RiskScanContext } from '../index.js';

const RESULT: OracleBehaviorResult = {
  applicable: true,
  sourceKey: 'chainlink-eth-usd',
  answerRaw: 150_000_000n,
  decimals: 8,
  roundId: 110n,
  answeredInRound: 110n,
  updatedAtSeconds: 1_752_000_000n,
  scanTimeSeconds: 1_752_000_030n,
  heartbeatSeconds: 3600,
  oraclePaused: false,
  sequencerConfigured: true,
  sequencerUp: true,
  sequencerRecoveredAtSeconds: null,
  sourceBlock: 200n,
};

function context(overrides: Partial<OracleBehaviorResult> = {}): RiskScanContext {
  return {
    target: { type: 'token', chainId: 4663, address: '0x3000000000000000000000000000000000000001' },
    sourceBlock: 200n,
    sourceBlockHash: `0x${'a'.repeat(64)}`,
    methodologyVersion: '1.0.0',
    data: { [ORACLE_OBSERVATION_SOURCE]: serializeOracleResult({ ...RESULT, ...overrides }) },
    dataSources: [],
  };
}

const abort = new AbortController().signal;
const rule = (code: string) =>
  createOracleRiskRules().find((r) => r.ruleId === `oracle.${code}`) ?? (() => {
    throw new Error(`missing rule oracle.${code}`);
  })();

describe('oracle behavior rules', () => {
  it('fails when the feed is older than its heartbeat', async () => {
    const evaluation = await rule('oracle_stale').evaluate(
      context({ updatedAtSeconds: 1_752_000_000n, scanTimeSeconds: 1_752_005_000n }),
      abort,
    );
    expect(evaluation.status).toBe('fail');
  });

  it('passes a fresh feed', async () => {
    const evaluation = await rule('oracle_stale').evaluate(context(), abort);
    expect(evaluation.status).toBe('pass');
  });

  it('fails on a non-positive answer', async () => {
    const evaluation = await rule('oracle_answer_invalid').evaluate(context({ answerRaw: 0n }), abort);
    expect(evaluation.status).toBe('fail');
  });

  it('warns on an incomplete round', async () => {
    const evaluation = await rule('oracle_incomplete_round').evaluate(
      context({ roundId: 111n, answeredInRound: 110n }),
      abort,
    );
    expect(evaluation.status).toBe('warning');
  });

  it('fails when paused', async () => {
    const evaluation = await rule('oracle_paused').evaluate(context({ oraclePaused: true }), abort);
    expect(evaluation.status).toBe('fail');
  });

  it('fails when the sequencer is down', async () => {
    const evaluation = await rule('sequencer_down').evaluate(context({ sequencerUp: false }), abort);
    expect(evaluation.status).toBe('fail');
    expect(evaluation.severity).toBe('critical');
  });

  it('warns inside the sequencer grace period', async () => {
    const evaluation = await rule('sequencer_grace_period').evaluate(
      context({ sequencerUp: true, sequencerRecoveredAtSeconds: 1_752_000_000n, scanTimeSeconds: 1_752_000_030n }),
      abort,
    );
    expect(evaluation.status).toBe('warning');
  });

  it('reports not_applicable for every rule when no oracle is configured', async () => {
    for (const r of createOracleRiskRules()) {
      const evaluation = await r.evaluate(
        context({ applicable: false, sourceKey: null, answerRaw: null }),
        abort,
      );
      expect(evaluation.status).toBe('not_applicable');
    }
  });

  it('reports unknown when an oracle is configured but has no reading', async () => {
    const evaluation = await rule('oracle_stale').evaluate(
      context({ applicable: true, answerRaw: null, updatedAtSeconds: null }),
      abort,
    );
    expect(evaluation.status).toBe('unknown');
  });

  it('gives not_applicable/unknown rules a zero max penalty', () => {
    for (const r of createOracleRiskRules()) {
      expect(r.maxPenaltyBps).toBeLessThanOrEqual(3000);
    }
  });
});
