import { and, asc, desc, eq, gt, lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Database } from '../../client.js';
import {
  type CursorPaginationOptions,
  type PaginatedResult,
  buildPaginatedResult,
  decodeCursorAsDate,
} from '../../core/pagination.js';
import type { TransactionContext } from '../../core/transaction.js';
import { adminAuditLogs } from '../../schema/product.js';
import type { AdminAuditLog, AuditRepository } from '../interfaces/audit-repository.js';

type AuditLogRow = typeof adminAuditLogs.$inferSelect;
// biome-ignore lint/suspicious/noExplicitAny: Executor needs to accept any schema
type Executor = PostgresJsDatabase<any>;

function toAuditLog(row: AuditLogRow): AdminAuditLog {
  return {
    id: row.id,
    adminUserId: row.adminUserId,
    actionType: row.actionType,
    targetType: row.targetType,
    targetId: row.targetId,
    changes: row.changes,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    performedAt: row.performedAt,
    createdAt: row.performedAt,
    updatedAt: row.performedAt,
  };
}

export class DrizzleAuditRepository implements AuditRepository {
  private readonly db: Executor;

  constructor(database: Database['db']) {
    this.db = database as Executor;
  }

  private resolve(tx?: TransactionContext): Executor {
    return (tx ?? this.db) as Executor;
  }

  async getAuditLog(id: string, tx?: TransactionContext): Promise<AdminAuditLog | null> {
    try {
      const rows = await this.resolve(tx)
        .select()
        .from(adminAuditLogs)
        .where(eq(adminAuditLogs.id, id))
        .limit(1);

      const row = rows[0];
      return row ? toAuditLog(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to get audit log "${id}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getAuditLogs(
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<AdminAuditLog>> {
    try {
      const { limit, cursor, orderBy } = options;
      const orderFn = orderBy === 'asc' ? asc : desc;
      const cursorOp = orderBy === 'asc' ? gt : lt;

      let query = this.resolve(tx)
        .select()
        .from(adminAuditLogs)
        .orderBy(orderFn(adminAuditLogs.performedAt), orderFn(adminAuditLogs.id))
        .limit(limit + 1)
        .$dynamic();

      if (cursor) {
        const cursorDate = decodeCursorAsDate(cursor);
        query = query.where(cursorOp(adminAuditLogs.performedAt, cursorDate));
      }

      const rows = await query;
      return buildPaginatedResult(rows.map(toAuditLog), limit, (item) => item.performedAt);
    } catch (error) {
      throw new Error(
        `Failed to get audit logs: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getAuditLogsByAdmin(
    adminUserId: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<AdminAuditLog>> {
    try {
      const { limit, cursor, orderBy } = options;
      const orderFn = orderBy === 'asc' ? asc : desc;
      const cursorOp = orderBy === 'asc' ? gt : lt;

      const conditions = [eq(adminAuditLogs.adminUserId, adminUserId)];

      if (cursor) {
        const cursorDate = decodeCursorAsDate(cursor);
        conditions.push(cursorOp(adminAuditLogs.performedAt, cursorDate));
      }

      const rows = await this.resolve(tx)
        .select()
        .from(adminAuditLogs)
        .where(and(...conditions))
        .orderBy(orderFn(adminAuditLogs.performedAt), orderFn(adminAuditLogs.id))
        .limit(limit + 1);

      return buildPaginatedResult(rows.map(toAuditLog), limit, (item) => item.performedAt);
    } catch (error) {
      throw new Error(
        `Failed to get audit logs for admin "${adminUserId}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getAuditLogsByTarget(
    targetType: string,
    targetId: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<AdminAuditLog>> {
    try {
      const { limit, cursor, orderBy } = options;
      const orderFn = orderBy === 'asc' ? asc : desc;
      const cursorOp = orderBy === 'asc' ? gt : lt;

      const conditions = [
        eq(adminAuditLogs.targetType, targetType),
        eq(adminAuditLogs.targetId, targetId),
      ];

      if (cursor) {
        const cursorDate = decodeCursorAsDate(cursor);
        conditions.push(cursorOp(adminAuditLogs.performedAt, cursorDate));
      }

      const rows = await this.resolve(tx)
        .select()
        .from(adminAuditLogs)
        .where(and(...conditions))
        .orderBy(orderFn(adminAuditLogs.performedAt), orderFn(adminAuditLogs.id))
        .limit(limit + 1);

      return buildPaginatedResult(rows.map(toAuditLog), limit, (item) => item.performedAt);
    } catch (error) {
      throw new Error(
        `Failed to get audit logs for target "${targetType}:${targetId}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async insertAuditLog(
    auditLog: Omit<AdminAuditLog, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<AdminAuditLog> {
    try {
      const rows = await this.resolve(tx)
        .insert(adminAuditLogs)
        .values({
          adminUserId: auditLog.adminUserId,
          actionType: auditLog.actionType as (typeof adminAuditLogs.actionType.enumValues)[number],
          targetType: auditLog.targetType,
          targetId: auditLog.targetId,
          changes: auditLog.changes,
          ipAddress: auditLog.ipAddress,
          userAgent: auditLog.userAgent,
          performedAt: auditLog.performedAt,
        })
        .returning();

      const row = rows[0];
      if (!row) {
        throw new Error('Insert returned no rows');
      }

      return toAuditLog(row);
    } catch (error) {
      throw new Error(
        `Failed to insert audit log: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async insertAuditLogs(
    auditLogs: Omit<AdminAuditLog, 'id' | 'createdAt' | 'updatedAt'>[],
    tx?: TransactionContext,
  ): Promise<AdminAuditLog[]> {
    try {
      if (auditLogs.length === 0) {
        return [];
      }

      const rows = await this.resolve(tx)
        .insert(adminAuditLogs)
        .values(
          auditLogs.map((log) => ({
            adminUserId: log.adminUserId,
            actionType: log.actionType as (typeof adminAuditLogs.actionType.enumValues)[number],
            targetType: log.targetType,
            targetId: log.targetId,
            changes: log.changes,
            ipAddress: log.ipAddress,
            userAgent: log.userAgent,
            performedAt: log.performedAt,
          })),
        )
        .returning();

      return rows.map(toAuditLog);
    } catch (error) {
      throw new Error(
        `Failed to insert audit logs: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
