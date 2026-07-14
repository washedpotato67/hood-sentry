import type { CursorPaginationOptions, PaginatedResult } from '../../core/pagination.js';
import type { TransactionContext } from '../../core/transaction.js';

export interface CommunityReport {
  id: string;
  chainId: number;
  targetAddress: string;
  targetType: string;
  reporterAddress: string;
  reportType: string;
  severity: string;
  description: string;
  evidenceUrls: unknown;
  status: string;
  submittedAt: Date;
  reviewedAt: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReportEvidence {
  id: string;
  reportId: string;
  evidenceType: string;
  evidenceData: unknown;
  submittedBy: string;
  submittedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReportRepository {
  getReport(id: string, tx?: TransactionContext): Promise<CommunityReport | null>;

  getReports(
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<CommunityReport>>;

  getReportsByTarget(
    chainId: number,
    targetAddress: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<CommunityReport>>;

  getReportsByReporter(
    reporterAddress: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<CommunityReport>>;

  insertReport(
    report: Omit<CommunityReport, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<CommunityReport>;

  updateReport(
    id: string,
    data: Partial<Omit<CommunityReport, 'id' | 'createdAt' | 'updatedAt'>>,
    tx?: TransactionContext,
  ): Promise<CommunityReport | null>;

  getEvidenceByReport(reportId: string, tx?: TransactionContext): Promise<ReportEvidence[]>;

  insertEvidence(
    evidence: Omit<ReportEvidence, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<ReportEvidence>;

  insertEvidenceBatch(
    evidence: Omit<ReportEvidence, 'id' | 'createdAt' | 'updatedAt'>[],
    tx?: TransactionContext,
  ): Promise<ReportEvidence[]>;
}
