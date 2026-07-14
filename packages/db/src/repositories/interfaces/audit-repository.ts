import type { CursorPaginationOptions, PaginatedResult } from '../../core/pagination.js';
import type { TransactionContext } from '../../core/transaction.js';

export interface AdminAuditLog {
  id: string;
  adminUserId: string;
  actionType: string;
  targetType: string;
  targetId: string;
  changes: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  performedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditRepository {
  getAuditLog(id: string, tx?: TransactionContext): Promise<AdminAuditLog | null>;

  getAuditLogs(
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<AdminAuditLog>>;

  getAuditLogsByAdmin(
    adminUserId: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<AdminAuditLog>>;

  getAuditLogsByTarget(
    targetType: string,
    targetId: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<AdminAuditLog>>;

  insertAuditLog(
    auditLog: Omit<AdminAuditLog, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<AdminAuditLog>;

  insertAuditLogs(
    auditLogs: Omit<AdminAuditLog, 'id' | 'createdAt' | 'updatedAt'>[],
    tx?: TransactionContext,
  ): Promise<AdminAuditLog[]>;
}
