import { describe, expect, it } from 'vitest';
import {
  RiskRuleRegistry,
  RiskScanOrchestrator,
  createFindingFingerprint,
  normalizeRescanRequest,
  riskScanIdempotencyKey,
} from '../index.js';
import type {
  RiskCategory,
  RiskRescanRequest,
  RiskRule,
  RiskRuleEvaluation,
  RiskRuleset,
  RiskScanContext,
} from '../index.js';

const ADDRESS = '0x1000000000000000000000000000000000000001';
const BLOCK_HASH = `0x${'a'.repeat(64)}`;
const OTHER_BLOCK_HASH = `0x${'b'.repeat(64)}`;

function evaluation(
  status: RiskRuleEvaluation['status'] = 'pass',
  title = 'Fixture result',
): RiskRuleEvaluation {
  return {
    status,
    severity: status === 'fail' ? 'high' : status === 'warning' ? 'medium' : 'info',
    confidence: {
      level: 'high',
      basisPoints: 9_000,
      rationale: 'Fixture data was present at the pinned block.',
    },
    title,
    explanation: 'The fixture rule returned a deterministic result.',
    evidence: [
      {
        evidenceType: 'fixture',
        summary: 'Pinned fixture evidence',
        data: { observed: status },
        provenanceKeys: ['chain'],
      },
    ],
    remediation: null,
    fingerprintSeed: 'fixture-condition',
  };
}

function rule(input: {
  id: string;
  version?: string;
  category?: RiskCategory;
  requiredDataSources?: readonly string[];
  run?: RiskRule['evaluate'];
}): RiskRule {
  return {
    ruleId: input.id,
    version: input.version ?? '1.0.0',
    category: input.category ?? 'Contract control',
    title: input.id,
    description: `Fixture rule ${input.id}`,
    requiredDataSources: input.requiredDataSources ?? ['chain'],
    maxPenaltyBps: 1_000,
    evaluate: input.run ?? (async () => evaluation()),
  };
}

function context(
  input: {
    block?: bigint;
    blockHash?: string;
    chainStatus?: 'available' | 'unavailable' | 'stale' | 'error';
  } = {},
): RiskScanContext {
  const sourceBlock = input.block ?? 100n;
  const sourceBlockHash = input.blockHash ?? BLOCK_HASH;
  return {
    target: { type: 'token', chainId: 4663, address: ADDRESS },
    sourceBlock,
    sourceBlockHash,
    methodologyVersion: 'risk-v1',
    data: { chain: { owner: ADDRESS } },
    dataSources: [
      {
        key: 'chain',
        kind: 'chain',
        provider: 'fixture-rpc',
        status: input.chainStatus ?? 'available',
        sourceBlock,
        sourceBlockHash,
        fetchedAt: '2026-07-14T12:00:00.000Z',
        reason:
          input.chainStatus === 'available' || input.chainStatus === undefined ? null : 'down',
      },
    ],
  };
}

function ruleset(rules: readonly RiskRule[]): RiskRuleset {
  return {
    version: 'ruleset-v1',
    methodologyVersion: 'risk-v1',
    rules: rules.map((item) => ({ ruleId: item.ruleId, version: item.version })),
    categoryPenaltyCapsBps: {
      'Contract control': 2_500,
      Supply: 1_500,
      Liquidity: 2_000,
    },
  };
}

async function scan(rules: readonly RiskRule[], scanContext = context()) {
  return new RiskScanOrchestrator(new RiskRuleRegistry(rules), 'engine-v1').scan(
    scanContext,
    ruleset(rules),
    { scanTimeoutMs: 1_000, perRuleTimeoutMs: 100 },
  );
}

describe('deterministic risk engine', () => {
  it('orders findings deterministically and repeats identical findings', async () => {
    const rules = [
      rule({ id: 'z-liquidity', category: 'Liquidity' }),
      rule({ id: 'b-control' }),
      rule({ id: 'a-control' }),
    ];
    const first = await scan(rules);
    const second = await scan([...rules].reverse());

    expect(first.findings.map((finding) => finding.ruleId)).toEqual([
      'a-control',
      'b-control',
      'z-liquidity',
    ]);
    expect(second.findings).toEqual(first.findings);
  });

  it('isolates a rule timeout and preserves the other result', async () => {
    const slow = rule({
      id: 'slow',
      run: (_scanContext, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    });
    const result = await new RiskScanOrchestrator(
      new RiskRuleRegistry([slow, rule({ id: 'healthy' })]),
      'engine-v1',
    ).scan(context(), ruleset([slow, rule({ id: 'healthy' })]), {
      scanTimeoutMs: 1_000,
      perRuleTimeoutMs: 5,
    });

    expect(result.status).toBe('partial');
    expect(result.failureCodes).toContain('RULE_TIMEOUT');
    expect(result.findings.find((finding) => finding.ruleId === 'healthy')?.status).toBe('pass');
    expect(result.findings.find((finding) => finding.ruleId === 'slow')?.status).toBe('unknown');
  });

  it('returns partial results after the scan timeout', async () => {
    const slow = rule({
      id: 'scan-timeout',
      run: (_scanContext, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    });
    const healthy = rule({ id: 'after-timeout', category: 'Supply' });
    const result = await new RiskScanOrchestrator(
      new RiskRuleRegistry([slow, healthy]),
      'engine-v1',
    ).scan(context(), ruleset([slow, healthy]), {
      scanTimeoutMs: 5,
      perRuleTimeoutMs: 100,
    });

    expect(result.status).toBe('partial');
    expect(result.failureCodes).toEqual(['SCAN_TIMEOUT']);
    expect(result.findings.every((finding) => finding.status === 'unknown')).toBe(true);
  });

  it('isolates a rule exception and returns a partial scan', async () => {
    const broken = rule({
      id: 'broken',
      run: async () => {
        throw new Error('fixture failure');
      },
    });
    const result = await scan([broken, rule({ id: 'healthy' })]);

    expect(result.status).toBe('partial');
    expect(result.failureCodes).toEqual(['RULE_EXCEPTION']);
    expect(result.findings).toHaveLength(2);
    expect(result.completeness.basisPoints).toBe(5_000);
  });

  it('treats unavailable data as unknown and reduces completeness', async () => {
    const result = await scan(
      [rule({ id: 'owner-check' })],
      context({ chainStatus: 'unavailable' }),
    );

    expect(result.findings[0]?.status).toBe('unknown');
    expect(result.findings[0]?.dataProvenance[0]?.status).toBe('unavailable');
    expect(result.completeness.basisPoints).toBe(0);
    expect(result.completeness.status).toBe('insufficient');
    expect(result.score.warnings).toContain('RISK_DATA_INCOMPLETE');
  });

  it('resolves explicit rule versions without replacing historical behavior', async () => {
    const firstVersion = rule({
      id: 'versioned',
      version: '1.0.0',
      run: async () => evaluation('pass', 'Version one'),
    });
    const secondVersion = rule({
      id: 'versioned',
      version: '2.0.0',
      run: async () => evaluation('fail', 'Version two'),
    });
    const registry = new RiskRuleRegistry([firstVersion, secondVersion]);
    const orchestrator = new RiskScanOrchestrator(registry, 'engine-v1');
    const first = await orchestrator.scan(context(), ruleset([firstVersion]), {
      scanTimeoutMs: 1_000,
      perRuleTimeoutMs: 100,
    });
    const second = await orchestrator.scan(
      context(),
      { ...ruleset([secondVersion]), version: 'ruleset-v2' },
      { scanTimeoutMs: 1_000, perRuleTimeoutMs: 100 },
    );

    expect(first.findings[0]).toMatchObject({ ruleVersion: '1.0.0', status: 'pass' });
    expect(second.findings[0]).toMatchObject({ ruleVersion: '2.0.0', status: 'fail' });
  });

  it('creates a stable finding fingerprint across source blocks', () => {
    const base = {
      target: context().target,
      ruleId: 'owner-check',
      ruleVersion: '1.0.0',
      fingerprintSeed: 'owner-is-eoa',
    };
    expect(createFindingFingerprint(base)).toBe(createFindingFingerprint({ ...base }));
  });

  it('cancels a scan and returns deterministic unknown findings', async () => {
    const controller = new AbortController();
    controller.abort(new Error('analyst cancellation'));
    const fixtureRule = rule({ id: 'cancelled-rule' });
    const result = await new RiskScanOrchestrator(
      new RiskRuleRegistry([fixtureRule]),
      'engine-v1',
    ).scan(context(), ruleset([fixtureRule]), {
      scanTimeoutMs: 1_000,
      perRuleTimeoutMs: 100,
      signal: controller.signal,
    });

    expect(result.status).toBe('cancelled');
    expect(result.failureCodes).toEqual(['SCAN_CANCELLED']);
    expect(result.findings[0]?.status).toBe('unknown');
  });

  it('produces one idempotency key for duplicate jobs', () => {
    const scanContext = context();
    const fixtureRuleset = ruleset([rule({ id: 'idempotent' })]);
    expect(riskScanIdempotencyKey(scanContext, fixtureRuleset, 'engine-v1')).toBe(
      riskScanIdempotencyKey(scanContext, fixtureRuleset, 'engine-v1'),
    );

    const request: RiskRescanRequest = {
      target: scanContext.target,
      trigger: 'new_token',
      sourceBlock: scanContext.sourceBlock,
      sourceBlockHash: scanContext.sourceBlockHash,
      rulesetVersion: fixtureRuleset.version,
      methodologyVersion: fixtureRuleset.methodologyVersion,
      eventId: 'log:1',
      requestedBy: 'indexer',
    };
    expect(normalizeRescanRequest(request).idempotencyKey).toBe(
      normalizeRescanRequest(request).idempotencyKey,
    );
  });

  it('pins rescans at different blocks and changes the job identity', async () => {
    const fixtureRule = rule({ id: 'block-aware' });
    const firstContext = context({ block: 100n, blockHash: BLOCK_HASH });
    const secondContext = context({ block: 101n, blockHash: OTHER_BLOCK_HASH });
    const first = await scan([fixtureRule], firstContext);
    const second = await scan([fixtureRule], secondContext);

    expect(first.findings[0]?.sourceBlock).toBe(100n);
    expect(second.findings[0]?.sourceBlock).toBe(101n);
    expect(riskScanIdempotencyKey(firstContext, ruleset([fixtureRule]), 'engine-v1')).not.toBe(
      riskScanIdempotencyKey(secondContext, ruleset([fixtureRule]), 'engine-v1'),
    );
  });

  it('rejects data sourced from a reorged block hash', async () => {
    const scanContext = context();
    const source = scanContext.dataSources[0];
    if (!source) throw new Error('Fixture source missing');
    const reorgedContext = {
      ...scanContext,
      sourceBlockHash: OTHER_BLOCK_HASH,
      dataSources: [source],
    };

    await expect(scan([rule({ id: 'reorg-check' })], reorgedContext)).rejects.toThrow(
      'not pinned to the scan block',
    );
  });

  it('applies a reasoned suppression without deleting evidence', async () => {
    const fixtureRule = rule({
      id: 'suppressed',
      run: async () => evaluation('fail'),
    });
    const result = await new RiskScanOrchestrator(
      new RiskRuleRegistry([fixtureRule]),
      'engine-v1',
    ).scan(context(), ruleset([fixtureRule]), {
      scanTimeoutMs: 1_000,
      perRuleTimeoutMs: 100,
      suppressions: [
        {
          ruleId: 'suppressed',
          ruleVersion: '1.0.0',
          fingerprint: null,
          reason: 'Reviewed against verified governance configuration.',
        },
      ],
    });

    expect(result.findings[0]).toMatchObject({
      suppressed: true,
      suppressionReason: 'Reviewed against verified governance configuration.',
      status: 'fail',
    });
    expect(result.findings[0]?.evidence).toHaveLength(1);
    expect(result.score.scoreBps).toBe(9_000);
  });
});
