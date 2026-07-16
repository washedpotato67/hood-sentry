import { evaluateRiskScoreAlertRule } from '@hood-sentry/alert-engine';
import { type Database, schema } from '@hood-sentry/db';
import type { Logger } from '@hood-sentry/observability';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import type { RiskAnalysisRunResult } from '../jobs/risk-runtime.js';
import type { AlertDeliveryService } from './alert-delivery.js';

function percentageToBasisPoints(value: string): bigint {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value);
  if (match === null) throw new Error('Stored risk score is malformed');
  const whole = match[1];
  if (whole === undefined) throw new Error('Stored risk score is malformed');
  const fraction = (match[2] ?? '').padEnd(2, '0');
  const result = BigInt(whole) * 100n + BigInt(fraction === '' ? '0' : fraction);
  if (result < 0n || result > 10_000n) throw new Error('Stored risk score is out of range');
  return result;
}

export interface RiskAlertEvaluationInput {
  chainId: number;
  targetAddress: `0x${string}`;
  sourceBlock: bigint;
  sourceBlockHash: string;
  run: RiskAnalysisRunResult;
}

export interface RiskAlertEvaluator {
  evaluate(input: RiskAlertEvaluationInput): Promise<void>;
}

export class RiskAlertService implements RiskAlertEvaluator {
  constructor(
    private readonly database: Database,
    private readonly logger: Logger,
    private readonly delivery: Pick<AlertDeliveryService, 'deliver'>,
  ) {}

  async evaluate(input: RiskAlertEvaluationInput): Promise<void> {
    const result = input.run.result;
    if (input.run.duplicate || result === null) return;
    const previousRows = await this.database.db
      .select({ score: schema.riskScores.score })
      .from(schema.riskScores)
      .innerJoin(schema.riskScanRuns, eq(schema.riskScores.scanRunId, schema.riskScanRuns.id))
      .where(
        and(
          eq(schema.riskScanRuns.chainId, input.chainId),
          eq(schema.riskScanRuns.targetAddress, input.targetAddress.toLowerCase()),
          eq(schema.riskScanRuns.canonical, true),
          ne(schema.riskScanRuns.id, input.run.scanRunId),
        ),
      )
      .orderBy(desc(schema.riskScanRuns.sourceBlock), desc(schema.riskScanRuns.completedAt))
      .limit(1);
    const previousScoreBps =
      previousRows[0] === undefined ? null : percentageToBasisPoints(previousRows[0].score);
    if (previousScoreBps === null) return;
    const blockRows = await this.database.db
      .select({ timestamp: schema.blocks.timestamp })
      .from(schema.blocks)
      .where(
        and(
          eq(schema.blocks.chainId, BigInt(input.chainId)),
          eq(schema.blocks.number, input.sourceBlock),
          eq(schema.blocks.hash, input.sourceBlockHash.toLowerCase()),
          eq(schema.blocks.canonical, true),
        ),
      )
      .limit(1);
    const sourceBlock = blockRows[0];
    if (sourceBlock === undefined) return;
    const rules = await this.database.db
      .select()
      .from(schema.alertRules)
      .where(
        and(
          eq(schema.alertRules.chainId, input.chainId),
          eq(schema.alertRules.targetAddress, input.targetAddress.toLowerCase()),
          eq(schema.alertRules.ruleType, 'risk_score_change'),
          eq(schema.alertRules.enabled, true),
          isNull(schema.alertRules.deletedAt),
        ),
      );
    for (const rule of rules) {
      let decision: ReturnType<typeof evaluateRiskScoreAlertRule>;
      try {
        decision = evaluateRiskScoreAlertRule(
          {
            ruleType: rule.ruleType,
            targetAddress: rule.targetAddress,
            condition: rule.condition,
          },
          {
            targetAddress: input.targetAddress,
            previousScoreBps,
            currentScoreBps: BigInt(result.score.scoreBps),
            methodologyVersion: result.score.methodologyVersion,
          },
        );
      } catch {
        this.logger.warn('Skipping risk alert rule with an invalid condition', {
          alertRuleId: rule.id,
        });
        continue;
      }
      if (decision === null) continue;
      await this.database.db
        .insert(schema.alertEvents)
        .values({
          alertRuleId: rule.id,
          chainId: input.chainId,
          blockNumber: input.sourceBlock,
          blockHash: input.sourceBlockHash.toLowerCase(),
          transactionHash: null,
          logIndex: null,
          triggeredAt: sourceBlock.timestamp,
          severity: decision.severity,
          metadata: {
            methodologyVersion: result.score.methodologyVersion,
            evidence: decision.evidence,
            scanRunId: input.run.scanRunId,
            targetAddress: input.targetAddress.toLowerCase(),
            blockHash: input.sourceBlockHash.toLowerCase(),
          },
          resolvedAt: null,
        })
        .onConflictDoNothing();
      const events = await this.database.db
        .select()
        .from(schema.alertEvents)
        .where(
          and(
            eq(schema.alertEvents.alertRuleId, rule.id),
            eq(schema.alertEvents.chainId, input.chainId),
            eq(schema.alertEvents.blockHash, input.sourceBlockHash.toLowerCase()),
            isNull(schema.alertEvents.transactionHash),
            isNull(schema.alertEvents.logIndex),
          ),
        )
        .limit(1);
      const event = events[0];
      if (event !== undefined) await this.delivery.deliver(event, rule);
    }
  }
}
