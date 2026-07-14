import type { CursorPaginationOptions, PaginatedResult } from '../../core/pagination.js';
import type { TransactionContext } from '../../core/transaction.js';

export interface RiskScanRun {
  id: string;
  chainId: number;
  targetAddress: string;
  engineVersion: string;
  rulesetVersion: string;
  sourceBlock: bigint;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RiskFinding {
  id: string;
  scanRunId: string;
  ruleId: string;
  ruleVersion: string;
  category: string;
  severity: string;
  confidence: string;
  title: string;
  explanation: string;
  evidence: unknown;
  remediation: string | null;
  sourceProvenance: unknown;
  fingerprint: string;
  suppressed: boolean;
  suppressionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RiskScore {
  id: string;
  scanRunId: string;
  score: string;
  grade: string;
  categoryScores: unknown;
  methodologyVersion: string;
  completenessPercent: string;
  unresolvedDataWarnings: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface RiskRepository {
  getScanRun(id: string, tx?: TransactionContext): Promise<RiskScanRun | null>;

  getScansByTarget(
    chainId: number,
    targetAddress: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<RiskScanRun>>;

  getLatestScan(
    chainId: number,
    targetAddress: string,
    tx?: TransactionContext,
  ): Promise<RiskScanRun | null>;

  insertScanRun(
    scanRun: Omit<RiskScanRun, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<RiskScanRun>;

  updateScanRun(
    id: string,
    data: Partial<Omit<RiskScanRun, 'id' | 'createdAt' | 'updatedAt'>>,
    tx?: TransactionContext,
  ): Promise<RiskScanRun | null>;

  getFindingsByScan(scanRunId: string, tx?: TransactionContext): Promise<RiskFinding[]>;

  getFindingsByTarget(
    chainId: number,
    targetAddress: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<RiskFinding>>;

  insertFinding(
    finding: Omit<RiskFinding, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<RiskFinding>;

  insertFindings(
    findings: Omit<RiskFinding, 'id' | 'createdAt' | 'updatedAt'>[],
    tx?: TransactionContext,
  ): Promise<RiskFinding[]>;

  getScoreByScan(scanRunId: string, tx?: TransactionContext): Promise<RiskScore | null>;

  insertScore(
    score: Omit<RiskScore, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<RiskScore>;
}
