import type {
  RiskRescanRequestRecord,
  RiskRulesetVersion,
  RiskScanRun,
  RiskFinding as StoredRiskFinding,
  RiskScore as StoredRiskScore,
} from '@hood-sentry/db';
import {
  type RiskRule,
  RiskRuleRegistry,
  type RiskRuleset,
  type RiskScanContext,
  RiskScanOrchestrator,
  riskRescanTriggerSchema,
} from '@hood-sentry/risk-engine';
import { describe, expect, it } from 'vitest';
import { RiskReorgJob, RiskRescanTriggerJob } from './risk-rescan.js';
import { RiskScanJob } from './risk-scan.js';

const ADDRESS = '0x1000000000000000000000000000000000000001';
const HASH = `0x${'a'.repeat(64)}`;

const fixtureRule: RiskRule = {
  ruleId: 'fixture-owner',
  version: '1.0.0',
  category: 'Contract control',
  title: 'Fixture owner check',
  description: 'Checks fixture ownership data.',
  requiredDataSources: ['chain'],
  maxPenaltyBps: 1_000,
  async evaluate() {
    return {
      status: 'pass',
      severity: 'info',
      confidence: { level: 'high', basisPoints: 9_000, rationale: 'Pinned chain data.' },
      title: 'Owner data present',
      explanation: 'The fixture owner data was present.',
      evidence: [
        {
          evidenceType: 'owner',
          summary: 'Owner read at the source block',
          data: { owner: ADDRESS },
          provenanceKeys: ['chain'],
        },
      ],
      remediation: null,
      fingerprintSeed: 'owner-data-present',
    };
  },
};

const fixtureRuleset: RiskRuleset = {
  version: 'ruleset-v1',
  methodologyVersion: 'risk-v1',
  rules: [{ ruleId: fixtureRule.ruleId, version: fixtureRule.version }],
  categoryPenaltyCapsBps: { 'Contract control': 2_500 },
};

function fixtureContext(): RiskScanContext {
  return {
    target: { type: 'token', chainId: 4663, address: ADDRESS },
    sourceBlock: 100n,
    sourceBlockHash: HASH,
    methodologyVersion: 'risk-v1',
    data: { owner: ADDRESS },
    dataSources: [
      {
        key: 'chain',
        kind: 'chain',
        provider: 'fixture-rpc',
        status: 'available',
        sourceBlock: 100n,
        sourceBlockHash: HASH,
        fetchedAt: '2026-07-14T12:00:00.000Z',
        reason: null,
      },
    ],
  };
}

function fixtureRun(status: RiskScanRun['status'] = 'running'): RiskScanRun {
  const date = new Date('2026-07-14T12:00:00.000Z');
  return {
    id: 'scan-1',
    chainId: 4663,
    targetType: 'token',
    targetAddress: ADDRESS.toLowerCase(),
    engineVersion: 'engine-v1',
    rulesetVersion: 'ruleset-v1',
    methodologyVersion: 'risk-v1',
    sourceBlock: 100n,
    sourceBlockHash: HASH,
    triggerType: 'new_token',
    idempotencyKey: 'key',
    canonical: true,
    partial: false,
    status,
    startedAt: date,
    completedAt: null,
    errorCode: null,
    cancellationRequestedAt: null,
    createdAt: date,
    updatedAt: date,
  };
}

function scanRepository(
  claimed: boolean,
  captures: {
    findings: StoredRiskFinding[];
    scores: StoredRiskScore[];
    updates: string[];
  },
) {
  return {
    async insertRulesetVersion(
      value: Omit<RiskRulesetVersion, 'createdAt'>,
    ): Promise<RiskRulesetVersion> {
      return { ...value, createdAt: new Date() };
    },
    async claimScanRun() {
      return { scanRun: fixtureRun(), claimed };
    },
    async isScanCancellationRequested() {
      return false;
    },
    async getActiveSuppressions() {
      return [];
    },
    async insertFindings(values: Omit<StoredRiskFinding, 'id' | 'createdAt' | 'updatedAt'>[]) {
      const stored = values.map((value, index) => ({
        ...value,
        id: `finding-${index.toString()}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      captures.findings.push(...stored);
      return stored;
    },
    async insertScore(value: Omit<StoredRiskScore, 'id' | 'createdAt' | 'updatedAt'>) {
      const stored = { ...value, id: 'score-1', createdAt: new Date(), updatedAt: new Date() };
      captures.scores.push(stored);
      return stored;
    },
    async updateScanRun(_id: string, value: Partial<RiskScanRun>) {
      if (value.status) captures.updates.push(value.status);
      return fixtureRun(value.status);
    },
  };
}

function captureState(): {
  findings: StoredRiskFinding[];
  scores: StoredRiskScore[];
  updates: string[];
} {
  return { findings: [], scores: [], updates: [] };
}

describe('risk worker jobs', () => {
  it('persists one deterministic scan result', async () => {
    const captures = captureState();
    const job = new RiskScanJob(
      new RiskScanOrchestrator(new RiskRuleRegistry([fixtureRule]), 'engine-v1'),
      fixtureRuleset,
      {
        async loadContext() {
          return fixtureContext();
        },
      },
      scanRepository(true, captures),
      { engineVersion: 'engine-v1', scanTimeoutMs: 1_000, perRuleTimeoutMs: 100 },
    );

    const result = await job.run({
      target: fixtureContext().target,
      sourceBlock: 100n,
      sourceBlockHash: HASH,
      trigger: 'new_token',
    });

    expect(result.duplicate).toBe(false);
    expect(result.result?.status).toBe('completed');
    expect(captures.findings[0]).toMatchObject({ status: 'pass', sourceBlock: 100n });
    expect(captures.scores[0]?.completenessDetail).toMatchObject({ basisPoints: 10_000 });
    expect(captures.updates).toEqual(['completed']);
  });

  it('does not execute a duplicate claimed job', async () => {
    const captures = captureState();
    const job = new RiskScanJob(
      new RiskScanOrchestrator(new RiskRuleRegistry([fixtureRule]), 'engine-v1'),
      fixtureRuleset,
      {
        async loadContext() {
          return fixtureContext();
        },
      },
      scanRepository(false, captures),
      { engineVersion: 'engine-v1', scanTimeoutMs: 1_000, perRuleTimeoutMs: 100 },
    );

    const result = await job.run({
      target: fixtureContext().target,
      sourceBlock: 100n,
      sourceBlockHash: HASH,
      trigger: 'new_token',
    });

    expect(result).toMatchObject({ duplicate: true, result: null, scanRunId: 'scan-1' });
    expect(captures.findings).toEqual([]);
    expect(captures.scores).toEqual([]);
  });

  it('stores every supported rescan trigger with an idempotency key', async () => {
    const stored: string[] = [];
    const job = new RiskRescanTriggerJob({
      async insertRescanRequest(request): Promise<RiskRescanRequestRecord> {
        stored.push(request.triggerType);
        return {
          ...request,
          id: `request-${stored.length.toString()}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    });

    for (const trigger of riskRescanTriggerSchema.options) {
      const result = await job.run({
        target: fixtureContext().target,
        trigger,
        sourceBlock: 100n,
        sourceBlockHash: HASH,
        rulesetVersion: 'ruleset-v1',
        methodologyVersion: 'risk-v1',
        eventId: `event-${trigger}`,
        requestedBy: 'indexer',
      });
      expect(result.idempotencyKey).toMatch(/^0x[0-9a-f]{64}$/);
    }
    expect(stored).toEqual(riskRescanTriggerSchema.options);
  });

  it('invalidates risk history from a reorg boundary', async () => {
    const calls: string[] = [];
    const job = new RiskReorgJob({
      async invalidateScansFromBlock(chainId, block) {
        calls.push(`${chainId.toString()}:${block.toString()}`);
        return 2;
      },
    });
    await expect(job.run({ chainId: 4663, fromBlock: 99n })).resolves.toEqual({
      invalidatedScans: 2,
      idempotencyKey: 'risk-reorg:4663:99',
    });
    expect(calls).toEqual(['4663:99']);
  });
});
