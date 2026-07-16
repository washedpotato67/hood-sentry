import type { CursorPaginationOptions, PaginatedResult } from '../../core/pagination.js';
import type { TransactionContext } from '../../core/transaction.js';

export type StoredRiskTargetType = 'token' | 'pool' | 'wallet' | 'project' | 'launchpad_token';
export type StoredRiskScanStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';
export type StoredRiskFindingStatus = 'pass' | 'warning' | 'fail' | 'unknown' | 'not_applicable';
export type StoredRiskRescanTrigger =
  | 'new_token'
  | 'source_verification'
  | 'proxy_implementation_change'
  | 'ownership_change'
  | 'role_change'
  | 'mint'
  | 'supply_change'
  | 'pool_creation'
  | 'liquidity_removal'
  | 'holder_concentration_change'
  | 'launchpad_graduation'
  | 'launchpad_migration'
  | 'token_code_change'
  | 'manual_analyst_request'
  | 'methodology_version_change';
export type StoredRiskRescanStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'orphaned';
export type StoredRiskSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type StoredRiskGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface RiskScanRun {
  id: string;
  chainId: number;
  targetType: StoredRiskTargetType;
  targetAddress: string;
  engineVersion: string;
  rulesetVersion: string;
  methodologyVersion: string;
  sourceBlock: bigint;
  sourceBlockHash: string | null;
  triggerType: StoredRiskRescanTrigger;
  idempotencyKey: string | null;
  canonical: boolean;
  partial: boolean;
  status: StoredRiskScanStatus;
  startedAt: Date;
  completedAt: Date | null;
  errorCode: string | null;
  cancellationRequestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RiskFinding {
  id: string;
  scanRunId: string;
  ruleId: string;
  ruleVersion: string;
  status: StoredRiskFindingStatus;
  category: string;
  severity: StoredRiskSeverity;
  confidence: string;
  confidenceDetail: unknown;
  title: string;
  explanation: string;
  evidence: unknown;
  remediation: string | null;
  sourceProvenance: unknown;
  sourceBlock: bigint | null;
  sourceBlockHash: string | null;
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
  grade: StoredRiskGrade;
  categoryScores: unknown;
  methodologyVersion: string;
  completenessPercent: string;
  unresolvedDataWarnings: unknown;
  completenessDetail: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface RiskRulesetVersion {
  version: string;
  methodologyVersion: string;
  engineVersion: string;
  ruleReferences: unknown;
  categoryPenaltyCapsBps: unknown;
  createdAt: Date;
}

export interface RiskRescanRequestRecord {
  id: string;
  chainId: number;
  targetType: StoredRiskTargetType;
  targetAddress: string;
  triggerType: StoredRiskRescanTrigger;
  sourceBlock: bigint;
  sourceBlockHash: string;
  rulesetVersion: string;
  methodologyVersion: string;
  eventId: string;
  requestedBy: string;
  idempotencyKey: string;
  status: StoredRiskRescanStatus;
  scanRunId: string | null;
  canonical: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RiskSuppressionRecord {
  id: string;
  chainId: number;
  targetAddress: string;
  ruleId: string | null;
  ruleVersion: string | null;
  fingerprint: string | null;
  reason: string;
  suppressedBy: string;
  suppressedAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokedBy: string | null;
  revocationReason: string | null;
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

  getScanByIdempotencyKey(
    idempotencyKey: string,
    tx?: TransactionContext,
  ): Promise<RiskScanRun | null>;

  insertScanRun(
    scanRun: Omit<RiskScanRun, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<RiskScanRun>;

  claimScanRun(
    scanRun: Omit<RiskScanRun, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<{ scanRun: RiskScanRun; claimed: boolean }>;

  updateScanRun(
    id: string,
    data: Partial<Omit<RiskScanRun, 'id' | 'createdAt' | 'updatedAt'>>,
    tx?: TransactionContext,
  ): Promise<RiskScanRun | null>;

  requestScanCancellation(id: string, tx?: TransactionContext): Promise<RiskScanRun | null>;

  isScanCancellationRequested(id: string, tx?: TransactionContext): Promise<boolean>;

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

  getRulesetVersion(version: string, tx?: TransactionContext): Promise<RiskRulesetVersion | null>;

  insertRulesetVersion(
    ruleset: Omit<RiskRulesetVersion, 'createdAt'>,
    tx?: TransactionContext,
  ): Promise<RiskRulesetVersion>;

  getRescanRequest(
    idempotencyKey: string,
    tx?: TransactionContext,
  ): Promise<RiskRescanRequestRecord | null>;

  insertRescanRequest(
    request: Omit<RiskRescanRequestRecord, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<RiskRescanRequestRecord>;

  updateRescanRequest(
    id: string,
    data: Partial<Pick<RiskRescanRequestRecord, 'status' | 'scanRunId' | 'canonical'>>,
    tx?: TransactionContext,
  ): Promise<RiskRescanRequestRecord | null>;

  getActiveSuppressions(
    chainId: number,
    targetAddress: string,
    at: Date,
    tx?: TransactionContext,
  ): Promise<RiskSuppressionRecord[]>;

  insertSuppression(
    suppression: Omit<RiskSuppressionRecord, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<RiskSuppressionRecord>;

  revokeSuppression(
    id: string,
    revokedBy: string,
    reason: string,
    tx?: TransactionContext,
  ): Promise<RiskSuppressionRecord | null>;

  invalidateScansFromBlock(
    chainId: number,
    fromBlock: bigint,
    tx?: TransactionContext,
  ): Promise<number>;
}
