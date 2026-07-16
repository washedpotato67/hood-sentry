import type { RiskRepository } from '@hood-sentry/db';
import {
  type RiskFinding,
  type RiskRuleset,
  type RiskScanContext,
  type RiskScanOrchestrator,
  type RiskScanResult,
  riskRescanTriggerSchema,
  riskScanIdempotencyKey,
  riskTargetSchema,
} from '@hood-sentry/risk-engine';
import { z } from 'zod';

const riskScanJobInputSchema = z.object({
  target: riskTargetSchema,
  sourceBlock: z.bigint().nonnegative(),
  sourceBlockHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  trigger: riskRescanTriggerSchema,
});

export type RiskScanJobInput = z.infer<typeof riskScanJobInputSchema>;

export interface RiskContextLoader {
  loadContext(input: RiskScanJobInput, methodologyVersion: string): Promise<RiskScanContext>;
}

type RiskScanRepository = Pick<
  RiskRepository,
  | 'insertRulesetVersion'
  | 'claimScanRun'
  | 'isScanCancellationRequested'
  | 'getActiveSuppressions'
  | 'insertFindings'
  | 'insertScore'
  | 'updateScanRun'
>;

function percentString(basisPoints: number): string {
  const whole = Math.floor(basisPoints / 100);
  const fraction = basisPoints % 100;
  return `${whole.toString()}.${fraction.toString().padStart(2, '0')}`;
}

function confidenceString(basisPoints: number): string {
  if (basisPoints === 10_000) return '1.00';
  const hundredths = Math.floor(basisPoints / 100);
  return `0.${hundredths.toString().padStart(2, '0')}`;
}

function findingRecord(scanRunId: string, finding: RiskFinding) {
  return {
    scanRunId,
    ruleId: finding.ruleId,
    ruleVersion: finding.ruleVersion,
    status: finding.status,
    category: finding.category,
    severity: finding.severity,
    confidence: confidenceString(finding.confidence.basisPoints),
    confidenceDetail: finding.confidence,
    title: finding.title,
    explanation: finding.explanation,
    evidence: finding.evidence,
    remediation: finding.remediation,
    sourceProvenance: finding.dataProvenance,
    sourceBlock: finding.sourceBlock,
    sourceBlockHash: finding.sourceBlockHash,
    fingerprint: finding.fingerprint,
    suppressed: finding.suppressed,
    suppressionReason: finding.suppressionReason,
  };
}

function contextMatches(input: RiskScanJobInput, context: RiskScanContext): boolean {
  return (
    input.target.type === context.target.type &&
    input.target.chainId === context.target.chainId &&
    input.target.address.toLowerCase() === context.target.address.toLowerCase() &&
    input.sourceBlock === context.sourceBlock &&
    input.sourceBlockHash.toLowerCase() === context.sourceBlockHash.toLowerCase()
  );
}

export class RiskScanJob {
  constructor(
    private readonly orchestrator: RiskScanOrchestrator,
    private readonly ruleset: RiskRuleset,
    private readonly contextLoader: RiskContextLoader,
    private readonly repository: RiskScanRepository,
    private readonly options: {
      engineVersion: string;
      scanTimeoutMs: number;
      perRuleTimeoutMs: number;
    },
  ) {}

  async run(
    rawInput: RiskScanJobInput,
    signal?: AbortSignal,
  ): Promise<{
    scanRunId: string;
    idempotencyKey: string;
    duplicate: boolean;
    result: RiskScanResult | null;
  }> {
    const input = riskScanJobInputSchema.parse(rawInput);
    const context = await this.contextLoader.loadContext(input, this.ruleset.methodologyVersion);
    if (!contextMatches(input, context)) {
      throw new Error('Risk scan context does not match the requested source block');
    }
    const idempotencyKey = riskScanIdempotencyKey(
      context,
      this.ruleset,
      this.options.engineVersion,
    );
    await this.repository.insertRulesetVersion({
      version: this.ruleset.version,
      methodologyVersion: this.ruleset.methodologyVersion,
      engineVersion: this.options.engineVersion,
      ruleReferences: this.ruleset.rules,
      categoryPenaltyCapsBps: this.ruleset.categoryPenaltyCapsBps,
    });
    const claimed = await this.repository.claimScanRun({
      chainId: input.target.chainId,
      targetType: input.target.type,
      targetAddress: input.target.address.toLowerCase(),
      engineVersion: this.options.engineVersion,
      rulesetVersion: this.ruleset.version,
      methodologyVersion: this.ruleset.methodologyVersion,
      sourceBlock: input.sourceBlock,
      sourceBlockHash: input.sourceBlockHash,
      triggerType: input.trigger,
      idempotencyKey,
      canonical: true,
      partial: false,
      status: 'running',
      startedAt: new Date(),
      completedAt: null,
      errorCode: null,
      cancellationRequestedAt: null,
    });
    if (!claimed.claimed) {
      return { scanRunId: claimed.scanRun.id, idempotencyKey, duplicate: true, result: null };
    }

    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (
      signal?.aborted ||
      (await this.repository.isScanCancellationRequested(claimed.scanRun.id))
    ) {
      controller.abort(new Error('Scan cancellation requested'));
    }

    try {
      const suppressions = await this.repository.getActiveSuppressions(
        input.target.chainId,
        input.target.address.toLowerCase(),
        new Date(),
      );
      const result = await this.orchestrator.scan(context, this.ruleset, {
        scanTimeoutMs: this.options.scanTimeoutMs,
        perRuleTimeoutMs: this.options.perRuleTimeoutMs,
        signal: controller.signal,
        suppressions: suppressions.map((suppression) => ({
          ruleId: suppression.ruleId,
          ruleVersion: suppression.ruleVersion,
          fingerprint: suppression.fingerprint,
          reason: suppression.reason,
        })),
      });
      if (result.engineVersion !== this.options.engineVersion) {
        throw new Error('Risk engine version does not match the persisted scan version');
      }
      await this.repository.insertFindings(
        result.findings.map((finding) => findingRecord(claimed.scanRun.id, finding)),
      );
      await this.repository.insertScore({
        scanRunId: claimed.scanRun.id,
        score: percentString(result.score.scoreBps),
        grade: result.score.grade,
        categoryScores: result.score.categoryScoresBps,
        methodologyVersion: result.score.methodologyVersion,
        completenessPercent: percentString(result.completeness.basisPoints),
        unresolvedDataWarnings: result.score.warnings,
        completenessDetail: result.completeness,
      });
      await this.repository.updateScanRun(claimed.scanRun.id, {
        status: result.status,
        partial: result.status !== 'completed',
        completedAt: new Date(),
        errorCode: result.failureCodes.length === 0 ? null : result.failureCodes.join(','),
      });
      return {
        scanRunId: claimed.scanRun.id,
        idempotencyKey,
        duplicate: false,
        result,
      };
    } catch (error) {
      await this.repository.updateScanRun(claimed.scanRun.id, {
        status: 'failed',
        partial: true,
        completedAt: new Date(),
        errorCode: 'SCAN_JOB_FAILURE',
      });
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }
}
