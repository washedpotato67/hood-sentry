import type { RiskFinding, RiskScanRun, RiskScore } from '@hood-sentry/db';
import { describe, expect, it, vi } from 'vitest';
import { RiskCommentaryService } from '../risk-commentary-service.js';

const scan: RiskScanRun = {
  id: '9f324767-3028-4bcf-b83d-4e85886fe9ca',
  chainId: 46630,
  targetType: 'token',
  targetAddress: '0x0000000000000000000000000000000000000001',
  engineVersion: '1.0.0',
  rulesetVersion: '1.0.0',
  methodologyVersion: '1.0.0',
  sourceBlock: 100n,
  sourceBlockHash: `0x${'1'.repeat(64)}`,
  triggerType: 'new_token',
  idempotencyKey: 'risk:100',
  canonical: true,
  partial: false,
  status: 'completed',
  startedAt: new Date('2026-07-15T10:00:00.000Z'),
  completedAt: new Date('2026-07-15T10:01:00.000Z'),
  errorCode: null,
  cancellationRequestedAt: null,
  createdAt: new Date('2026-07-15T10:00:00.000Z'),
  updatedAt: new Date('2026-07-15T10:01:00.000Z'),
};

const score: RiskScore = {
  id: '1b3ca2f7-758a-4bc8-8de9-ec851286b1bb',
  scanRunId: scan.id,
  score: '82.00',
  grade: 'B',
  categoryScores: {},
  methodologyVersion: scan.methodologyVersion,
  completenessPercent: '95.00',
  unresolvedDataWarnings: [],
  completenessDetail: {},
  createdAt: scan.createdAt,
  updatedAt: scan.updatedAt,
};

const finding: RiskFinding = {
  id: '0fb763d1-e01b-46a8-b9fd-5f9625f6ef7e',
  scanRunId: scan.id,
  ruleId: 'owner-control',
  ruleVersion: '1.0.0',
  status: 'warning',
  category: 'privilege',
  severity: 'medium',
  confidence: 'high',
  confidenceDetail: {},
  title: 'Owner retains control',
  explanation: 'The owner retains a privileged function.',
  evidence: [],
  remediation: 'Move ownership to a timelock.',
  sourceProvenance: [],
  sourceBlock: 100n,
  sourceBlockHash: scan.sourceBlockHash,
  fingerprint: `0x${'2'.repeat(64)}`,
  suppressed: false,
  suppressionReason: null,
  createdAt: scan.createdAt,
  updatedAt: scan.updatedAt,
};

describe('risk commentary service', () => {
  it('stores commentary separately from score and finding data', async () => {
    const risk = {
      getLatestScan: vi.fn().mockResolvedValue(scan),
      getScoreByScan: vi.fn().mockResolvedValue(score),
      getFindingsByScan: vi.fn().mockResolvedValue([finding]),
    };
    const evidence = {
      getFresh: vi.fn().mockResolvedValue(null),
      insert: vi.fn(async (record) => ({
        ...record,
        id: '22b2fc8e-b5af-4d76-986c-5397dcd0f91d',
        createdAt: new Date('2026-07-15T12:00:00.000Z'),
      })),
    };
    const provider = {
      generate: vi.fn().mockResolvedValue({
        commentary: {
          summary: 'One medium privilege warning is active.',
          evidenceHighlights: ['Owner control is present.'],
          limitations: ['The report is pinned to block 100.'],
          userActions: ['Review the owner address.'],
        },
        providerResponseId: 'resp_123',
        providerId: 'openai' as const,
        model: 'gpt-5.4-mini-2026-03-17',
        promptVersion: 'risk-commentary-v1' as const,
        fetchedAt: '2026-07-15T12:00:00.000Z',
        inputTokens: 100,
        outputTokens: 40,
      }),
    };
    const service = new RiskCommentaryService(
      risk,
      evidence,
      provider,
      { enabled: true, model: 'gpt-5.4-mini-2026-03-17', cacheSeconds: 3_600 },
      () => new Date('2026-07-15T12:00:00.000Z'),
    );

    const result = await service.get(46630, scan.targetAddress);

    expect(result).toMatchObject({
      affectsRiskFindings: false,
      affectsRiskScore: false,
      scan: { id: scan.id, sourceBlock: '100' },
    });
    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        score: expect.objectContaining({ value: '82.00' }),
        findings: [expect.objectContaining({ ruleId: 'owner-control' })],
      }),
    );
    expect(evidence.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        trustClass: 'commentary',
        capability: 'aiCommentary',
        sourceBlockNumber: 100n,
      }),
    );
  });
});
