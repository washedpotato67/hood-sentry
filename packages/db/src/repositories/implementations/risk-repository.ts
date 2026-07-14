import { and, asc, desc, eq, gt, lt } from 'drizzle-orm';

import type { Database } from '../../client.js';
import {
  type CursorPaginationOptions,
  type PaginatedResult,
  buildPaginatedResult,
  decodeCursorAsDate,
} from '../../core/pagination.js';
import type { TransactionContext } from '../../core/transaction.js';
import { riskFindings, riskScanRuns, riskScores } from '../../schema/risk.js';
import type {
  RiskFinding,
  RiskRepository,
  RiskScanRun,
  RiskScore,
} from '../interfaces/risk-repository.js';

type ScanRunRow = typeof riskScanRuns.$inferSelect;
type FindingRow = typeof riskFindings.$inferSelect;
type ScoreRow = typeof riskScores.$inferSelect;

function toScanRun(row: ScanRunRow): RiskScanRun {
  return {
    id: row.id,
    chainId: row.chainId,
    targetAddress: row.targetAddress,
    engineVersion: row.engineVersion,
    rulesetVersion: row.rulesetVersion,
    sourceBlock: row.sourceBlock,
    status: row.status,
    startedAt: row.startedAt ?? row.createdAt,
    completedAt: row.completedAt,
    errorCode: row.errorCode,
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
    category: row.category,
    severity: row.severity,
    confidence: row.confidence,
    title: row.title,
    explanation: row.explanation,
    evidence: row.evidence,
    remediation: row.remediation,
    sourceProvenance: row.sourceProvenance,
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
          and(eq(riskScanRuns.chainId, chainId), eq(riskScanRuns.targetAddress, targetAddress)),
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

  async insertScanRun(
    scanRun: Omit<RiskScanRun, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<RiskScanRun> {
    try {
      const rows = await this.executor(tx)
        .insert(riskScanRuns)
        .values({
          chainId: scanRun.chainId,
          targetAddress: scanRun.targetAddress,
          engineVersion: scanRun.engineVersion,
          rulesetVersion: scanRun.rulesetVersion,
          sourceBlock: scanRun.sourceBlock,
          status: scanRun.status as (typeof riskScanRuns.$inferInsert)['status'],
          startedAt: scanRun.startedAt,
          completedAt: scanRun.completedAt,
          errorCode: scanRun.errorCode,
        })
        .returning();

      return toScanRun(ensureRow(rows[0], 'insertScanRun'));
    } catch (error) {
      throw new Error(
        `Failed to insert scan run: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async updateScanRun(
    id: string,
    data: Partial<Omit<RiskScanRun, 'id' | 'createdAt' | 'updatedAt'>>,
    tx?: TransactionContext,
  ): Promise<RiskScanRun | null> {
    try {
      const setValues: Record<string, unknown> = { updatedAt: new Date() };

      if (data.chainId !== undefined) setValues.chainId = data.chainId;
      if (data.targetAddress !== undefined) setValues.targetAddress = data.targetAddress;
      if (data.engineVersion !== undefined) setValues.engineVersion = data.engineVersion;
      if (data.rulesetVersion !== undefined) setValues.rulesetVersion = data.rulesetVersion;
      if (data.sourceBlock !== undefined) setValues.sourceBlock = data.sourceBlock;
      if (data.status !== undefined) setValues.status = data.status;
      if (data.startedAt !== undefined) setValues.startedAt = data.startedAt;
      if (data.completedAt !== undefined) setValues.completedAt = data.completedAt;
      if (data.errorCode !== undefined) setValues.errorCode = data.errorCode;

      const rows = await this.executor(tx)
        .update(riskScanRuns)
        .set(setValues)
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

  async getFindingsByScan(scanRunId: string, tx?: TransactionContext): Promise<RiskFinding[]> {
    try {
      const rows = await this.executor(tx)
        .select()
        .from(riskFindings)
        .where(eq(riskFindings.scanRunId, scanRunId))
        .orderBy(asc(riskFindings.severity), asc(riskFindings.id));

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
          category: riskFindings.category,
          severity: riskFindings.severity,
          confidence: riskFindings.confidence,
          title: riskFindings.title,
          explanation: riskFindings.explanation,
          evidence: riskFindings.evidence,
          remediation: riskFindings.remediation,
          sourceProvenance: riskFindings.sourceProvenance,
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
          category: finding.category,
          severity: finding.severity as (typeof riskFindings.$inferInsert)['severity'],
          confidence: finding.confidence,
          title: finding.title,
          explanation: finding.explanation,
          evidence: finding.evidence,
          remediation: finding.remediation,
          sourceProvenance: finding.sourceProvenance,
          fingerprint: finding.fingerprint,
          suppressed: finding.suppressed,
          suppressionReason: finding.suppressionReason,
        })
        .returning();

      return toFinding(ensureRow(rows[0], 'insertFinding'));
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
            category: f.category,
            severity: f.severity as (typeof riskFindings.$inferInsert)['severity'],
            confidence: f.confidence,
            title: f.title,
            explanation: f.explanation,
            evidence: f.evidence,
            remediation: f.remediation,
            sourceProvenance: f.sourceProvenance,
            fingerprint: f.fingerprint,
            suppressed: f.suppressed,
            suppressionReason: f.suppressionReason,
          })),
        )
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
          grade: score.grade as (typeof riskScores.$inferInsert)['grade'],
          categoryScores: score.categoryScores,
          methodologyVersion: score.methodologyVersion,
          completenessPercent: score.completenessPercent,
          unresolvedDataWarnings: score.unresolvedDataWarnings,
        })
        .returning();

      return toScore(ensureRow(rows[0], 'insertScore'));
    } catch (error) {
      throw new Error(
        `Failed to insert score: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
