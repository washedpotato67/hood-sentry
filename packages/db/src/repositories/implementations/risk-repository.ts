import { isDeepStrictEqual } from 'node:util';
import { and, asc, desc, eq, gt, gte, isNull, lt, or, sql } from 'drizzle-orm';

import type { Database } from '../../client.js';
import {
  type CursorPaginationOptions,
  type PaginatedResult,
  buildPaginatedResult,
  decodeCursorAsDate,
} from '../../core/pagination.js';
import type { TransactionContext } from '../../core/transaction.js';
import {
  riskFindings,
  riskRescanRequests,
  riskRulesetVersions,
  riskScanRuns,
  riskScores,
  riskSuppressions,
} from '../../schema/risk.js';
import type {
  RiskFinding,
  RiskRepository,
  RiskRescanRequestRecord,
  RiskRulesetVersion,
  RiskScanRun,
  RiskScore,
  RiskSuppressionRecord,
  TokenSignalCounts,
} from '../interfaces/risk-repository.js';

type ScanRunRow = typeof riskScanRuns.$inferSelect;
type FindingRow = typeof riskFindings.$inferSelect;
type ScoreRow = typeof riskScores.$inferSelect;
type RulesetRow = typeof riskRulesetVersions.$inferSelect;
type RescanRequestRow = typeof riskRescanRequests.$inferSelect;
type SuppressionRow = typeof riskSuppressions.$inferSelect;

function toScanRun(row: ScanRunRow): RiskScanRun {
  return {
    id: row.id,
    chainId: row.chainId,
    targetType: row.targetType,
    targetAddress: row.targetAddress,
    engineVersion: row.engineVersion,
    rulesetVersion: row.rulesetVersion,
    methodologyVersion: row.methodologyVersion,
    sourceBlock: row.sourceBlock,
    sourceBlockHash: row.sourceBlockHash,
    triggerType: row.triggerType,
    idempotencyKey: row.idempotencyKey,
    canonical: row.canonical,
    partial: row.partial,
    status: row.status,
    startedAt: row.startedAt ?? row.createdAt,
    completedAt: row.completedAt,
    errorCode: row.errorCode,
    cancellationRequestedAt: row.cancellationRequestedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toFinding(row: FindingRow): RiskFinding {
  return {
    id: row.id,
    scanRunId: row.scanRunId,
    ruleId: row.ruleId,
    ruleVersion: row.ruleVersion,
    status: row.status,
    category: row.category,
    severity: row.severity,
    confidence: row.confidence,
    confidenceDetail: row.confidenceDetail,
    title: row.title,
    explanation: row.explanation,
    evidence: row.evidence,
    remediation: row.remediation,
    sourceProvenance: row.sourceProvenance,
    sourceBlock: row.sourceBlock,
    sourceBlockHash: row.sourceBlockHash,
    fingerprint: row.fingerprint,
    suppressed: row.suppressed,
    suppressionReason: row.suppressionReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toScore(row: ScoreRow): RiskScore {
  return {
    id: row.id,
    scanRunId: row.scanRunId,
    score: row.score,
    grade: row.grade,
    categoryScores: row.categoryScores,
    methodologyVersion: row.methodologyVersion,
    completenessPercent: row.completenessPercent,
    unresolvedDataWarnings: row.unresolvedDataWarnings,
    completenessDetail: row.completenessDetail,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRulesetVersion(row: RulesetRow): RiskRulesetVersion {
  return {
    version: row.version,
    methodologyVersion: row.methodologyVersion,
    engineVersion: row.engineVersion,
    ruleReferences: row.ruleReferences,
    categoryPenaltyCapsBps: row.categoryPenaltyCapsBps,
    createdAt: row.createdAt,
  };
}

function toRescanRequest(row: RescanRequestRow): RiskRescanRequestRecord {
  return {
    id: row.id,
    chainId: row.chainId,
    targetType: row.targetType,
    targetAddress: row.targetAddress,
    triggerType: row.triggerType,
    sourceBlock: row.sourceBlock,
    sourceBlockHash: row.sourceBlockHash,
    rulesetVersion: row.rulesetVersion,
    methodologyVersion: row.methodologyVersion,
    eventId: row.eventId,
    requestedBy: row.requestedBy,
    idempotencyKey: row.idempotencyKey,
    status: row.status,
    scanRunId: row.scanRunId,
    canonical: row.canonical,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSuppression(row: SuppressionRow): RiskSuppressionRecord {
  return {
    id: row.id,
    chainId: row.chainId,
    targetAddress: row.targetAddress,
    ruleId: row.ruleId,
    ruleVersion: row.ruleVersion,
    fingerprint: row.fingerprint,
    reason: row.reason,
    suppressedBy: row.suppressedBy,
    suppressedAt: row.suppressedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    revokedBy: row.revokedBy,
    revocationReason: row.revocationReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function ensureRow<T>(row: T | undefined, operation: string): T {
  if (!row) {
    throw new Error(`Invariant violation: ${operation} returned no rows`);
  }
  return row;
}

export class DrizzleRiskRepository implements RiskRepository {
  constructor(private readonly db: Database['db']) {}

  private executor(tx?: TransactionContext) {
    return tx ?? this.db;
  }

  async getScanRun(id: string, tx?: TransactionContext): Promise<RiskScanRun | null> {
    try {
      const rows = await this.executor(tx)
        .select()
        .from(riskScanRuns)
        .where(eq(riskScanRuns.id, id))
        .limit(1);

      const row = rows[0];
      return row ? toScanRun(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to get scan run "${id}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getScansByTarget(
    chainId: number,
    targetAddress: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<RiskScanRun>> {
    try {
      const { limit, cursor, orderBy } = options;
      const orderFn = orderBy === 'asc' ? asc : desc;
      const cursorCmp = orderBy === 'asc' ? gt : lt;

      const conditions = [
        eq(riskScanRuns.chainId, chainId),
        eq(riskScanRuns.targetAddress, targetAddress),
      ];

      if (cursor) {
        conditions.push(cursorCmp(riskScanRuns.createdAt, decodeCursorAsDate(cursor)));
      }

      const rows = await this.executor(tx)
        .select()
        .from(riskScanRuns)
        .where(and(...conditions))
        .orderBy(orderFn(riskScanRuns.createdAt), orderFn(riskScanRuns.id))
        .limit(limit + 1);

      return buildPaginatedResult(rows.map(toScanRun), limit, (item) => item.createdAt);
    } catch (error) {
      throw new Error(
        `Failed to get scans for target ${chainId}:${targetAddress}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getFindingSeverityCounts(
    chainId: number,
    targetAddresses: readonly string[],
    tx?: TransactionContext,
  ): Promise<TokenSignalCounts[]> {
    if (targetAddresses.length === 0) return [];
    // Match case-insensitively: feed addresses are checksummed, stored targets
    // may differ in case.
    const lowered = targetAddresses.map((address) => address.toLowerCase());
    const list = sql.join(
      lowered.map((address) => sql`${address}`),
      sql`, `,
    );
    // DISTINCT ON picks the latest canonical scan per token; the join to findings
    // drops tokens with none (they render as "clean"). Counts arrive as bigint
    // strings from COUNT(*).
    //
    // Only findings the analyzer actually reached a verdict on count as risk. A
    // rule that could not run records a zero-confidence finding titled
    // "... unavailable", and a rule that ran and found nothing records an `info`
    // finding titled "... not found". Counting either as a low-severity risk
    // reports a clean or unchecked contract as a risky one, which is the exact
    // black-box behaviour this product exists to avoid. The count of rules that
    // could not run is returned separately so it can be shown as what it is.
    const rows = (await this.executor(tx).execute(sql`
      WITH latest AS (
        SELECT DISTINCT ON (target_address) id, target_address
        FROM risk_scan_runs
        WHERE chain_id = ${chainId}
          AND target_type = 'token'
          AND canonical = true
          AND lower(target_address) IN (${list})
        ORDER BY target_address, created_at DESC, id DESC
      )
      SELECT lower(latest.target_address) AS target_address,
        COUNT(*) FILTER (
          WHERE risk_findings.severity IN ('critical', 'high')
            AND risk_findings.confidence > 0
        ) AS high,
        COUNT(*) FILTER (
          WHERE risk_findings.severity = 'medium'
            AND risk_findings.confidence > 0
        ) AS medium,
        COUNT(*) FILTER (
          WHERE risk_findings.severity = 'low'
            AND risk_findings.confidence > 0
        ) AS low,
        COUNT(*) FILTER (WHERE risk_findings.confidence = 0) AS unavailable
      FROM latest
      JOIN risk_findings
        ON risk_findings.scan_run_id = latest.id
        AND risk_findings.suppressed = false
      GROUP BY lower(latest.target_address)
    `)) as unknown as Array<{
      target_address: string;
      high: string | number;
      medium: string | number;
      low: string | number;
      unavailable: string | number;
    }>;

    return rows.map((row) => ({
      targetAddress: row.target_address,
      high: Number(row.high),
      medium: Number(row.medium),
      low: Number(row.low),
      unavailable: Number(row.unavailable),
    }));
  }

  async getLatestScan(
    chainId: number,
    targetAddress: string,
    tx?: TransactionContext,
  ): Promise<RiskScanRun | null> {
    try {
      const rows = await this.executor(tx)
        .select()
        .from(riskScanRuns)
        .where(
          and(
            eq(riskScanRuns.chainId, chainId),
            eq(riskScanRuns.targetAddress, targetAddress),
            eq(riskScanRuns.canonical, true),
          ),
        )
        .orderBy(desc(riskScanRuns.createdAt), desc(riskScanRuns.id))
        .limit(1);

      const row = rows[0];
      return row ? toScanRun(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to get latest scan for target ${chainId}:${targetAddress}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getScanByIdempotencyKey(
    idempotencyKey: string,
    tx?: TransactionContext,
  ): Promise<RiskScanRun | null> {
    try {
      const rows = await this.executor(tx)
        .select()
        .from(riskScanRuns)
        .where(eq(riskScanRuns.idempotencyKey, idempotencyKey))
        .limit(1);
      const row = rows[0];
      return row ? toScanRun(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to get risk scan job "${idempotencyKey}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async insertScanRun(
    scanRun: Omit<RiskScanRun, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<RiskScanRun> {
    return (await this.claimScanRun(scanRun, tx)).scanRun;
  }

  async claimScanRun(
    scanRun: Omit<RiskScanRun, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<{ scanRun: RiskScanRun; claimed: boolean }> {
    try {
      const rows = await this.executor(tx)
        .insert(riskScanRuns)
        .values({
          chainId: scanRun.chainId,
          targetType: scanRun.targetType,
          targetAddress: scanRun.targetAddress,
          engineVersion: scanRun.engineVersion,
          rulesetVersion: scanRun.rulesetVersion,
          methodologyVersion: scanRun.methodologyVersion,
          sourceBlock: scanRun.sourceBlock,
          sourceBlockHash: scanRun.sourceBlockHash,
          triggerType: scanRun.triggerType,
          idempotencyKey: scanRun.idempotencyKey,
          canonical: scanRun.canonical,
          partial: scanRun.partial,
          status: scanRun.status,
          startedAt: scanRun.startedAt,
          completedAt: scanRun.completedAt,
          errorCode: scanRun.errorCode,
          cancellationRequestedAt: scanRun.cancellationRequestedAt,
        })
        .onConflictDoNothing()
        .returning();
      const inserted = rows[0];
      if (inserted) return { scanRun: toScanRun(inserted), claimed: true };
      if (scanRun.idempotencyKey !== null) {
        const reclaimedRows = await this.executor(tx)
          .update(riskScanRuns)
          .set({
            status: 'running',
            partial: false,
            startedAt: scanRun.startedAt,
            completedAt: null,
            errorCode: null,
            cancellationRequestedAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(riskScanRuns.idempotencyKey, scanRun.idempotencyKey),
              eq(riskScanRuns.status, 'failed'),
            ),
          )
          .returning();
        const reclaimed = reclaimedRows[0];
        if (reclaimed) return { scanRun: toScanRun(reclaimed), claimed: true };

        const existing = await this.getScanByIdempotencyKey(scanRun.idempotencyKey, tx);
        if (existing) return { scanRun: existing, claimed: false };
      }
      throw new Error('Invariant violation: insertScanRun returned no rows');
    } catch (error) {
      throw new Error(
        `Failed to claim scan run: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async updateScanRun(
    id: string,
    data: Partial<Omit<RiskScanRun, 'id' | 'createdAt' | 'updatedAt'>>,
    tx?: TransactionContext,
  ): Promise<RiskScanRun | null> {
    try {
      const rows = await this.executor(tx)
        .update(riskScanRuns)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(riskScanRuns.id, id))
        .returning();

      const row = rows[0];
      return row ? toScanRun(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to update scan run "${id}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async requestScanCancellation(id: string, tx?: TransactionContext): Promise<RiskScanRun | null> {
    try {
      const rows = await this.executor(tx)
        .update(riskScanRuns)
        .set({ cancellationRequestedAt: new Date(), updatedAt: new Date() })
        .where(eq(riskScanRuns.id, id))
        .returning();
      const row = rows[0];
      return row ? toScanRun(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to request cancellation for scan "${id}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async isScanCancellationRequested(id: string, tx?: TransactionContext): Promise<boolean> {
    try {
      const rows = await this.executor(tx)
        .select({ cancellationRequestedAt: riskScanRuns.cancellationRequestedAt })
        .from(riskScanRuns)
        .where(eq(riskScanRuns.id, id))
        .limit(1);
      return rows[0]?.cancellationRequestedAt !== null && rows[0] !== undefined;
    } catch (error) {
      throw new Error(
        `Failed to read cancellation state for scan "${id}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getFindingsByScan(scanRunId: string, tx?: TransactionContext): Promise<RiskFinding[]> {
    try {
      const rows = await this.executor(tx)
        .select()
        .from(riskFindings)
        .where(eq(riskFindings.scanRunId, scanRunId))
        .orderBy(
          asc(riskFindings.category),
          asc(riskFindings.ruleId),
          asc(riskFindings.ruleVersion),
          asc(riskFindings.fingerprint),
        );

      return rows.map(toFinding);
    } catch (error) {
      throw new Error(
        `Failed to get findings for scan "${scanRunId}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getFindingsByTarget(
    chainId: number,
    targetAddress: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<RiskFinding>> {
    try {
      const { limit, cursor, orderBy } = options;
      const orderFn = orderBy === 'asc' ? asc : desc;
      const cursorCmp = orderBy === 'asc' ? gt : lt;

      const conditions = [
        eq(riskScanRuns.chainId, chainId),
        eq(riskScanRuns.targetAddress, targetAddress),
      ];

      if (cursor) {
        conditions.push(cursorCmp(riskFindings.createdAt, decodeCursorAsDate(cursor)));
      }

      const rows = await this.executor(tx)
        .select({
          id: riskFindings.id,
          scanRunId: riskFindings.scanRunId,
          ruleId: riskFindings.ruleId,
          ruleVersion: riskFindings.ruleVersion,
          status: riskFindings.status,
          category: riskFindings.category,
          severity: riskFindings.severity,
          confidence: riskFindings.confidence,
          confidenceDetail: riskFindings.confidenceDetail,
          title: riskFindings.title,
          explanation: riskFindings.explanation,
          evidence: riskFindings.evidence,
          remediation: riskFindings.remediation,
          sourceProvenance: riskFindings.sourceProvenance,
          sourceBlock: riskFindings.sourceBlock,
          sourceBlockHash: riskFindings.sourceBlockHash,
          fingerprint: riskFindings.fingerprint,
          suppressed: riskFindings.suppressed,
          suppressionReason: riskFindings.suppressionReason,
          createdAt: riskFindings.createdAt,
          updatedAt: riskFindings.updatedAt,
        })
        .from(riskFindings)
        .innerJoin(riskScanRuns, eq(riskFindings.scanRunId, riskScanRuns.id))
        .where(and(...conditions))
        .orderBy(orderFn(riskFindings.createdAt), orderFn(riskFindings.id))
        .limit(limit + 1);

      return buildPaginatedResult(rows.map(toFinding), limit, (item) => item.createdAt);
    } catch (error) {
      throw new Error(
        `Failed to get findings for target ${chainId}:${targetAddress}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async insertFinding(
    finding: Omit<RiskFinding, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<RiskFinding> {
    try {
      const rows = await this.executor(tx)
        .insert(riskFindings)
        .values({
          scanRunId: finding.scanRunId,
          ruleId: finding.ruleId,
          ruleVersion: finding.ruleVersion,
          status: finding.status,
          category: finding.category,
          severity: finding.severity,
          confidence: finding.confidence,
          confidenceDetail: finding.confidenceDetail,
          title: finding.title,
          explanation: finding.explanation,
          evidence: finding.evidence,
          remediation: finding.remediation,
          sourceProvenance: finding.sourceProvenance,
          sourceBlock: finding.sourceBlock,
          sourceBlockHash: finding.sourceBlockHash,
          fingerprint: finding.fingerprint,
          suppressed: finding.suppressed,
          suppressionReason: finding.suppressionReason,
        })
        .onConflictDoNothing()
        .returning();
      const inserted = rows[0];
      if (inserted) return toFinding(inserted);
      const existing = await this.executor(tx)
        .select()
        .from(riskFindings)
        .where(
          and(
            eq(riskFindings.scanRunId, finding.scanRunId),
            eq(riskFindings.fingerprint, finding.fingerprint),
          ),
        )
        .limit(1);
      return toFinding(ensureRow(existing[0], 'insertFinding'));
    } catch (error) {
      throw new Error(
        `Failed to insert finding: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async insertFindings(
    findings: Omit<RiskFinding, 'id' | 'createdAt' | 'updatedAt'>[],
    tx?: TransactionContext,
  ): Promise<RiskFinding[]> {
    try {
      if (findings.length === 0) {
        return [];
      }

      const rows = await this.executor(tx)
        .insert(riskFindings)
        .values(
          findings.map((f) => ({
            scanRunId: f.scanRunId,
            ruleId: f.ruleId,
            ruleVersion: f.ruleVersion,
            status: f.status,
            category: f.category,
            severity: f.severity,
            confidence: f.confidence,
            confidenceDetail: f.confidenceDetail,
            title: f.title,
            explanation: f.explanation,
            evidence: f.evidence,
            remediation: f.remediation,
            sourceProvenance: f.sourceProvenance,
            sourceBlock: f.sourceBlock,
            sourceBlockHash: f.sourceBlockHash,
            fingerprint: f.fingerprint,
            suppressed: f.suppressed,
            suppressionReason: f.suppressionReason,
          })),
        )
        .onConflictDoNothing()
        .returning();

      return rows.map(toFinding);
    } catch (error) {
      throw new Error(
        `Failed to insert findings: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getScoreByScan(scanRunId: string, tx?: TransactionContext): Promise<RiskScore | null> {
    try {
      const rows = await this.executor(tx)
        .select()
        .from(riskScores)
        .where(eq(riskScores.scanRunId, scanRunId))
        .limit(1);

      const row = rows[0];
      return row ? toScore(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to get score for scan "${scanRunId}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async insertScore(
    score: Omit<RiskScore, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<RiskScore> {
    try {
      const rows = await this.executor(tx)
        .insert(riskScores)
        .values({
          scanRunId: score.scanRunId,
          score: score.score,
          grade: score.grade,
          categoryScores: score.categoryScores,
          methodologyVersion: score.methodologyVersion,
          completenessPercent: score.completenessPercent,
          unresolvedDataWarnings: score.unresolvedDataWarnings,
          completenessDetail: score.completenessDetail,
        })
        .onConflictDoUpdate({
          target: riskScores.scanRunId,
          set: {
            score: score.score,
            grade: score.grade,
            categoryScores: score.categoryScores,
            methodologyVersion: score.methodologyVersion,
            completenessPercent: score.completenessPercent,
            unresolvedDataWarnings: score.unresolvedDataWarnings,
            completenessDetail: score.completenessDetail,
            updatedAt: new Date(),
          },
        })
        .returning();

      return toScore(ensureRow(rows[0], 'insertScore'));
    } catch (error) {
      throw new Error(
        `Failed to insert score: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getRulesetVersion(
    version: string,
    tx?: TransactionContext,
  ): Promise<RiskRulesetVersion | null> {
    try {
      const rows = await this.executor(tx)
        .select()
        .from(riskRulesetVersions)
        .where(eq(riskRulesetVersions.version, version))
        .limit(1);
      const row = rows[0];
      return row ? toRulesetVersion(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to get risk ruleset "${version}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async insertRulesetVersion(
    ruleset: Omit<RiskRulesetVersion, 'createdAt'>,
    tx?: TransactionContext,
  ): Promise<RiskRulesetVersion> {
    try {
      const rows = await this.executor(tx)
        .insert(riskRulesetVersions)
        .values(ruleset)
        .onConflictDoNothing()
        .returning();
      const inserted = rows[0];
      if (inserted) return toRulesetVersion(inserted);
      const existing = await this.getRulesetVersion(ruleset.version, tx);
      const stored = ensureRow(existing ?? undefined, 'insertRulesetVersion');
      if (
        stored.methodologyVersion !== ruleset.methodologyVersion ||
        stored.engineVersion !== ruleset.engineVersion ||
        !isDeepStrictEqual(stored.ruleReferences, ruleset.ruleReferences) ||
        !isDeepStrictEqual(stored.categoryPenaltyCapsBps, ruleset.categoryPenaltyCapsBps)
      ) {
        throw new Error(`Risk ruleset version "${ruleset.version}" is immutable`);
      }
      return stored;
    } catch (error) {
      throw new Error(
        `Failed to insert risk ruleset "${ruleset.version}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getRescanRequest(
    idempotencyKey: string,
    tx?: TransactionContext,
  ): Promise<RiskRescanRequestRecord | null> {
    try {
      const rows = await this.executor(tx)
        .select()
        .from(riskRescanRequests)
        .where(eq(riskRescanRequests.idempotencyKey, idempotencyKey))
        .limit(1);
      const row = rows[0];
      return row ? toRescanRequest(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to get risk rescan request "${idempotencyKey}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async insertRescanRequest(
    request: Omit<RiskRescanRequestRecord, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<RiskRescanRequestRecord> {
    try {
      const rows = await this.executor(tx)
        .insert(riskRescanRequests)
        .values({
          ...request,
          targetType: request.targetType,
          triggerType: request.triggerType,
          status: request.status,
        })
        .onConflictDoNothing()
        .returning();
      const inserted = rows[0];
      if (inserted) return toRescanRequest(inserted);
      const existing = await this.getRescanRequest(request.idempotencyKey, tx);
      return ensureRow(existing ?? undefined, 'insertRescanRequest');
    } catch (error) {
      throw new Error(
        `Failed to insert risk rescan request: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async updateRescanRequest(
    id: string,
    data: Partial<Pick<RiskRescanRequestRecord, 'status' | 'scanRunId' | 'canonical'>>,
    tx?: TransactionContext,
  ): Promise<RiskRescanRequestRecord | null> {
    try {
      const values: Record<string, unknown> = { updatedAt: new Date() };
      if (data.status !== undefined) values.status = data.status;
      if (data.scanRunId !== undefined) values.scanRunId = data.scanRunId;
      if (data.canonical !== undefined) values.canonical = data.canonical;
      const rows = await this.executor(tx)
        .update(riskRescanRequests)
        .set(values)
        .where(eq(riskRescanRequests.id, id))
        .returning();
      const row = rows[0];
      return row ? toRescanRequest(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to update risk rescan request "${id}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getActiveSuppressions(
    chainId: number,
    targetAddress: string,
    at: Date,
    tx?: TransactionContext,
  ): Promise<RiskSuppressionRecord[]> {
    try {
      const rows = await this.executor(tx)
        .select()
        .from(riskSuppressions)
        .where(
          and(
            eq(riskSuppressions.chainId, chainId),
            eq(riskSuppressions.targetAddress, targetAddress),
            isNull(riskSuppressions.revokedAt),
            or(isNull(riskSuppressions.expiresAt), gt(riskSuppressions.expiresAt, at)),
          ),
        )
        .orderBy(asc(riskSuppressions.suppressedAt), asc(riskSuppressions.id));
      return rows.map(toSuppression);
    } catch (error) {
      throw new Error(
        `Failed to get active risk suppressions: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async insertSuppression(
    suppression: Omit<RiskSuppressionRecord, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<RiskSuppressionRecord> {
    if (suppression.ruleId === null && suppression.fingerprint === null) {
      throw new Error('A risk suppression requires a rule ID or fingerprint');
    }
    if (suppression.reason.trim().length === 0) {
      throw new Error('A risk suppression requires a reason');
    }
    try {
      const rows = await this.executor(tx).insert(riskSuppressions).values(suppression).returning();
      return toSuppression(ensureRow(rows[0], 'insertSuppression'));
    } catch (error) {
      throw new Error(
        `Failed to insert risk suppression: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async revokeSuppression(
    id: string,
    revokedBy: string,
    reason: string,
    tx?: TransactionContext,
  ): Promise<RiskSuppressionRecord | null> {
    if (revokedBy.trim().length === 0 || reason.trim().length === 0) {
      throw new Error('Suppression revocation requires an actor and reason');
    }
    try {
      const rows = await this.executor(tx)
        .update(riskSuppressions)
        .set({
          revokedAt: new Date(),
          revokedBy,
          revocationReason: reason,
          updatedAt: new Date(),
        })
        .where(and(eq(riskSuppressions.id, id), isNull(riskSuppressions.revokedAt)))
        .returning();
      const row = rows[0];
      return row ? toSuppression(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to revoke risk suppression "${id}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async invalidateScansFromBlock(
    chainId: number,
    fromBlock: bigint,
    tx?: TransactionContext,
  ): Promise<number> {
    try {
      const invalidated = await this.executor(tx)
        .update(riskScanRuns)
        .set({ canonical: false, updatedAt: new Date() })
        .where(
          and(
            eq(riskScanRuns.chainId, chainId),
            gte(riskScanRuns.sourceBlock, fromBlock),
            eq(riskScanRuns.canonical, true),
          ),
        )
        .returning({ id: riskScanRuns.id });
      await this.executor(tx)
        .update(riskRescanRequests)
        .set({ canonical: false, status: 'orphaned', updatedAt: new Date() })
        .where(
          and(
            eq(riskRescanRequests.chainId, chainId),
            gte(riskRescanRequests.sourceBlock, fromBlock),
            eq(riskRescanRequests.canonical, true),
          ),
        );
      return invalidated.length;
    } catch (error) {
      throw new Error(
        `Failed to invalidate risk scans from ${chainId}:${fromBlock.toString()}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
