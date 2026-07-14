import { and, asc, desc, eq, gt, lt } from 'drizzle-orm';
import type { Database } from '../../client.js';
import { buildPaginatedResult, decodeCursor } from '../../core/pagination.js';
import type { CursorPaginationOptions, PaginatedResult } from '../../core/pagination.js';
import type { TransactionContext } from '../../core/transaction.js';
import { communityReports, reportEvidence } from '../../schema/product.js';
import type {
  CommunityReport,
  ReportEvidence,
  ReportRepository,
} from '../interfaces/report-repository.js';

type CommunityReportRow = typeof communityReports.$inferSelect;
type ReportEvidenceRow = typeof reportEvidence.$inferSelect;

function toCommunityReport(row: CommunityReportRow): CommunityReport {
  return {
    id: row.id,
    chainId: row.chainId,
    targetAddress: row.targetAddress,
    targetType: row.targetType,
    reporterAddress: row.reporterAddress,
    reportType: row.reportType,
    severity: row.severity,
    description: row.description,
    evidenceUrls: row.evidenceUrls,
    status: row.status,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    resolvedAt: row.resolvedAt,
    createdAt: row.submittedAt,
    updatedAt: row.resolvedAt ?? row.reviewedAt ?? row.submittedAt,
  };
}

function toReportEvidence(row: ReportEvidenceRow): ReportEvidence {
  return {
    id: row.id,
    reportId: row.reportId,
    evidenceType: row.evidenceType,
    evidenceData: row.evidenceData,
    submittedBy: row.submittedBy,
    submittedAt: row.submittedAt,
    createdAt: row.submittedAt,
    updatedAt: row.submittedAt,
  };
}

export class DrizzleReportRepository implements ReportRepository {
  constructor(private readonly db: Database['db']) {}

  private resolve(tx?: TransactionContext): TransactionContext {
    return tx ?? this.db;
  }

  async getReport(id: string, tx?: TransactionContext): Promise<CommunityReport | null> {
    try {
      const rows = await this.resolve(tx)
        .select()
        .from(communityReports)
        .where(eq(communityReports.id, id))
        .limit(1);

      const row = rows[0];
      return row ? toCommunityReport(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to get report "${id}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getReports(
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<CommunityReport>> {
    try {
      const { limit, cursor, orderBy } = options;
      const conditions = [];

      if (cursor) {
        const decodedCursor = decodeCursor(cursor);
        conditions.push(
          orderBy === 'asc'
            ? gt(communityReports.id, decodedCursor)
            : lt(communityReports.id, decodedCursor),
        );
      }

      const rows = await this.resolve(tx)
        .select()
        .from(communityReports)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(orderBy === 'asc' ? asc(communityReports.id) : desc(communityReports.id))
        .limit(limit + 1);

      const reports = rows.map(toCommunityReport);
      return buildPaginatedResult(reports, limit, (item) => item.id);
    } catch (error) {
      throw new Error(
        `Failed to get reports: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getReportsByTarget(
    chainId: number,
    targetAddress: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<CommunityReport>> {
    try {
      const { limit, cursor, orderBy } = options;
      const conditions = [
        eq(communityReports.chainId, chainId),
        eq(communityReports.targetAddress, targetAddress),
      ];

      if (cursor) {
        const decodedCursor = decodeCursor(cursor);
        conditions.push(
          orderBy === 'asc'
            ? gt(communityReports.id, decodedCursor)
            : lt(communityReports.id, decodedCursor),
        );
      }

      const rows = await this.resolve(tx)
        .select()
        .from(communityReports)
        .where(and(...conditions))
        .orderBy(orderBy === 'asc' ? asc(communityReports.id) : desc(communityReports.id))
        .limit(limit + 1);

      const reports = rows.map(toCommunityReport);
      return buildPaginatedResult(reports, limit, (item) => item.id);
    } catch (error) {
      throw new Error(
        `Failed to get reports for target ${targetAddress} on chain ${chainId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getReportsByReporter(
    reporterAddress: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<CommunityReport>> {
    try {
      const { limit, cursor, orderBy } = options;
      const conditions = [eq(communityReports.reporterAddress, reporterAddress)];

      if (cursor) {
        const decodedCursor = decodeCursor(cursor);
        conditions.push(
          orderBy === 'asc'
            ? gt(communityReports.id, decodedCursor)
            : lt(communityReports.id, decodedCursor),
        );
      }

      const rows = await this.resolve(tx)
        .select()
        .from(communityReports)
        .where(and(...conditions))
        .orderBy(orderBy === 'asc' ? asc(communityReports.id) : desc(communityReports.id))
        .limit(limit + 1);

      const reports = rows.map(toCommunityReport);
      return buildPaginatedResult(reports, limit, (item) => item.id);
    } catch (error) {
      throw new Error(
        `Failed to get reports for reporter "${reporterAddress}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async insertReport(
    report: Omit<CommunityReport, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<CommunityReport> {
    try {
      const rows = await this.resolve(tx)
        .insert(communityReports)
        .values({
          chainId: report.chainId,
          targetAddress: report.targetAddress,
          targetType: report.targetType as 'token' | 'wallet' | 'contract',
          reporterAddress: report.reporterAddress,
          reportType: report.reportType as
            | 'scam'
            | 'rug_pull'
            | 'honeypot'
            | 'exploit'
            | 'phishing'
            | 'impersonation'
            | 'other',
          severity: report.severity as 'low' | 'medium' | 'high' | 'critical',
          description: report.description,
          evidenceUrls: report.evidenceUrls,
          status: report.status as
            | 'submitted'
            | 'under_review'
            | 'upheld'
            | 'rejected'
            | 'appealed',
          submittedAt: report.submittedAt,
          reviewedAt: report.reviewedAt,
          resolvedAt: report.resolvedAt,
        })
        .returning();

      const row = rows[0];
      if (!row) {
        throw new Error('Insert returned no rows');
      }

      return toCommunityReport(row);
    } catch (error) {
      throw new Error(
        `Failed to insert report: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async updateReport(
    id: string,
    data: Partial<Omit<CommunityReport, 'id' | 'createdAt' | 'updatedAt'>>,
    tx?: TransactionContext,
  ): Promise<CommunityReport | null> {
    try {
      const setFields: Record<string, unknown> = {};

      // Build set fields from data, filtering out undefined values
      const fieldMappings: Array<[keyof typeof data, string]> = [
        ['chainId', 'chain_id'],
        ['targetAddress', 'target_address'],
        ['targetType', 'target_type'],
        ['reporterAddress', 'reporter_address'],
        ['reportType', 'report_type'],
        ['severity', 'severity'],
        ['description', 'description'],
        ['evidenceUrls', 'evidence_urls'],
        ['status', 'status'],
        ['submittedAt', 'submitted_at'],
        ['reviewedAt', 'reviewed_at'],
        ['resolvedAt', 'resolved_at'],
      ];

      for (const [dataKey, dbKey] of fieldMappings) {
        const value = data[dataKey];
        if (value !== undefined) {
          setFields[dbKey] = value;
        }
      }

      if (Object.keys(setFields).length === 0) {
        return this.getReport(id, tx);
      }

      const rows = await this.resolve(tx)
        .update(communityReports)
        .set(setFields)
        .where(eq(communityReports.id, id))
        .returning();

      const row = rows[0];
      return row ? toCommunityReport(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to update report "${id}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getEvidenceByReport(reportId: string, tx?: TransactionContext): Promise<ReportEvidence[]> {
    try {
      const rows = await this.resolve(tx)
        .select()
        .from(reportEvidence)
        .where(eq(reportEvidence.reportId, reportId))
        .orderBy(asc(reportEvidence.id));

      return rows.map(toReportEvidence);
    } catch (error) {
      throw new Error(
        `Failed to get evidence for report "${reportId}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async insertEvidence(
    evidence: Omit<ReportEvidence, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<ReportEvidence> {
    try {
      const rows = await this.resolve(tx)
        .insert(reportEvidence)
        .values({
          reportId: evidence.reportId,
          evidenceType: evidence.evidenceType as
            | 'screenshot'
            | 'transaction_hash'
            | 'contract_code'
            | 'chat_log'
            | 'url'
            | 'document',
          evidenceData: evidence.evidenceData,
          submittedBy: evidence.submittedBy,
          submittedAt: evidence.submittedAt,
        })
        .returning();

      const row = rows[0];
      if (!row) {
        throw new Error('Insert returned no rows');
      }

      return toReportEvidence(row);
    } catch (error) {
      throw new Error(
        `Failed to insert evidence for report "${evidence.reportId}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async insertEvidenceBatch(
    evidence: Omit<ReportEvidence, 'id' | 'createdAt' | 'updatedAt'>[],
    tx?: TransactionContext,
  ): Promise<ReportEvidence[]> {
    try {
      if (evidence.length === 0) {
        return [];
      }

      const values = evidence.map((e) => ({
        reportId: e.reportId,
        evidenceType: e.evidenceType as
          | 'screenshot'
          | 'transaction_hash'
          | 'contract_code'
          | 'chat_log'
          | 'url'
          | 'document',
        evidenceData: e.evidenceData,
        submittedBy: e.submittedBy,
        submittedAt: e.submittedAt,
      }));

      const rows = await this.resolve(tx).insert(reportEvidence).values(values).returning();

      return rows.map(toReportEvidence);
    } catch (error) {
      throw new Error(
        `Failed to insert evidence batch: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
