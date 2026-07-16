import { and, asc, desc, eq, gt, isNull, lt } from 'drizzle-orm';

import type { Database } from '../../client.js';
import {
  type CursorPaginationOptions,
  type PaginatedResult,
  buildPaginatedResult,
  decodeCursorAsDate,
} from '../../core/pagination.js';
import type { TransactionContext } from '../../core/transaction.js';
import { alertEvents, alertRules } from '../../schema/product.js';
import type { AlertEvent, AlertRepository, AlertRule } from '../interfaces/alert-repository.js';

type AlertRuleRow = typeof alertRules.$inferSelect;
type AlertEventRow = typeof alertEvents.$inferSelect;

function toAlertRule(row: AlertRuleRow): AlertRule {
  return {
    id: row.id,
    userId: row.userId,
    chainId: row.chainId,
    targetAddress: row.targetAddress,
    ruleType: row.ruleType,
    condition: row.condition,
    channels: row.channels,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

function toAlertEvent(row: AlertEventRow): AlertEvent {
  return {
    id: row.id,
    alertRuleId: row.alertRuleId,
    chainId: row.chainId,
    blockNumber: row.blockNumber,
    blockHash: row.blockHash,
    transactionHash: row.transactionHash,
    logIndex: row.logIndex,
    triggeredAt: row.triggeredAt,
    severity: row.severity,
    metadata: row.metadata,
    resolvedAt: row.resolvedAt,
    createdAt: row.triggeredAt,
    updatedAt: row.resolvedAt ?? row.triggeredAt,
  };
}

function ensureRow<T>(row: T | undefined, operation: string): T {
  if (!row) {
    throw new Error(`Invariant violation: ${operation} returned no rows`);
  }
  return row;
}

export class DrizzleAlertRepository implements AlertRepository {
  constructor(private readonly db: Database['db']) {}

  private executor(tx?: TransactionContext) {
    return tx ?? this.db;
  }

  async getAlertRule(id: string, tx?: TransactionContext): Promise<AlertRule | null> {
    try {
      const rows = await this.executor(tx)
        .select()
        .from(alertRules)
        .where(and(eq(alertRules.id, id), isNull(alertRules.deletedAt)))
        .limit(1);

      const row = rows[0];
      return row ? toAlertRule(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to get alert rule "${id}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getAlertRulesByUser(
    userId: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<AlertRule>> {
    try {
      const { limit, cursor, orderBy } = options;
      const orderFn = orderBy === 'asc' ? asc : desc;
      const cursorCmp = orderBy === 'asc' ? gt : lt;

      const conditions = [eq(alertRules.userId, userId), isNull(alertRules.deletedAt)];

      if (cursor) {
        conditions.push(cursorCmp(alertRules.createdAt, decodeCursorAsDate(cursor)));
      }

      const rows = await this.executor(tx)
        .select()
        .from(alertRules)
        .where(and(...conditions))
        .orderBy(orderFn(alertRules.createdAt), orderFn(alertRules.id))
        .limit(limit + 1);

      return buildPaginatedResult(rows.map(toAlertRule), limit, (item) => item.createdAt);
    } catch (error) {
      throw new Error(
        `Failed to get alert rules for user "${userId}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getAlertRulesByTarget(
    chainId: number,
    targetAddress: string,
    tx?: TransactionContext,
  ): Promise<AlertRule[]> {
    try {
      const rows = await this.executor(tx)
        .select()
        .from(alertRules)
        .where(
          and(
            eq(alertRules.chainId, chainId),
            eq(alertRules.targetAddress, targetAddress),
            isNull(alertRules.deletedAt),
          ),
        )
        .orderBy(asc(alertRules.createdAt), asc(alertRules.id));

      return rows.map(toAlertRule);
    } catch (error) {
      throw new Error(
        `Failed to get alert rules for target ${chainId}:${targetAddress}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async insertAlertRule(
    alertRule: Omit<AlertRule, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>,
    tx?: TransactionContext,
  ): Promise<AlertRule> {
    try {
      const rows = await this.executor(tx)
        .insert(alertRules)
        .values({
          userId: alertRule.userId,
          chainId: alertRule.chainId,
          targetAddress: alertRule.targetAddress,
          ruleType: alertRule.ruleType as (typeof alertRules.$inferInsert)['ruleType'],
          condition: alertRule.condition,
          channels: alertRule.channels,
          enabled: alertRule.enabled,
        })
        .returning();

      return toAlertRule(ensureRow(rows[0], 'insertAlertRule'));
    } catch (error) {
      throw new Error(
        `Failed to insert alert rule: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async updateAlertRule(
    id: string,
    data: Partial<Omit<AlertRule, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>>,
    tx?: TransactionContext,
  ): Promise<AlertRule | null> {
    try {
      const setValues: Record<string, unknown> = { updatedAt: new Date() };

      if (data.userId !== undefined) setValues.userId = data.userId;
      if (data.chainId !== undefined) setValues.chainId = data.chainId;
      if (data.targetAddress !== undefined) setValues.targetAddress = data.targetAddress;
      if (data.ruleType !== undefined) setValues.ruleType = data.ruleType;
      if (data.condition !== undefined) setValues.condition = data.condition;
      if (data.channels !== undefined) setValues.channels = data.channels;
      if (data.enabled !== undefined) setValues.enabled = data.enabled;

      const rows = await this.executor(tx)
        .update(alertRules)
        .set(setValues)
        .where(and(eq(alertRules.id, id), isNull(alertRules.deletedAt)))
        .returning();

      const row = rows[0];
      return row ? toAlertRule(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to update alert rule "${id}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async deleteAlertRule(id: string, tx?: TransactionContext): Promise<boolean> {
    try {
      const now = new Date();
      const rows = await this.executor(tx)
        .update(alertRules)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(alertRules.id, id), isNull(alertRules.deletedAt)))
        .returning();

      return rows.length > 0;
    } catch (error) {
      throw new Error(
        `Failed to delete alert rule "${id}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getAlertEvent(id: string, tx?: TransactionContext): Promise<AlertEvent | null> {
    try {
      const rows = await this.executor(tx)
        .select()
        .from(alertEvents)
        .where(eq(alertEvents.id, id))
        .limit(1);

      const row = rows[0];
      return row ? toAlertEvent(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to get alert event "${id}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getAlertEventsByRule(
    alertRuleId: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<AlertEvent>> {
    try {
      const { limit, cursor, orderBy } = options;
      const orderFn = orderBy === 'asc' ? asc : desc;
      const cursorCmp = orderBy === 'asc' ? gt : lt;

      const conditions = [eq(alertEvents.alertRuleId, alertRuleId)];

      if (cursor) {
        conditions.push(cursorCmp(alertEvents.triggeredAt, decodeCursorAsDate(cursor)));
      }

      const rows = await this.executor(tx)
        .select()
        .from(alertEvents)
        .where(and(...conditions))
        .orderBy(orderFn(alertEvents.triggeredAt), orderFn(alertEvents.id))
        .limit(limit + 1);

      return buildPaginatedResult(rows.map(toAlertEvent), limit, (item) => item.triggeredAt);
    } catch (error) {
      throw new Error(
        `Failed to get alert events for rule "${alertRuleId}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getUnresolvedAlertEvents(chainId: number, tx?: TransactionContext): Promise<AlertEvent[]> {
    try {
      const rows = await this.executor(tx)
        .select()
        .from(alertEvents)
        .where(and(eq(alertEvents.chainId, chainId), isNull(alertEvents.resolvedAt)))
        .orderBy(asc(alertEvents.triggeredAt), asc(alertEvents.id));

      return rows.map(toAlertEvent);
    } catch (error) {
      throw new Error(
        `Failed to get unresolved alert events for chain ${chainId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async insertAlertEvent(
    alertEvent: Omit<AlertEvent, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<AlertEvent> {
    try {
      const rows = await this.executor(tx)
        .insert(alertEvents)
        .values({
          alertRuleId: alertEvent.alertRuleId,
          chainId: alertEvent.chainId,
          blockNumber: alertEvent.blockNumber,
          blockHash: alertEvent.blockHash,
          transactionHash: alertEvent.transactionHash,
          logIndex: alertEvent.logIndex,
          triggeredAt: alertEvent.triggeredAt,
          severity: alertEvent.severity as (typeof alertEvents.$inferInsert)['severity'],
          metadata: alertEvent.metadata,
          resolvedAt: alertEvent.resolvedAt,
        })
        .returning();

      return toAlertEvent(ensureRow(rows[0], 'insertAlertEvent'));
    } catch (error) {
      throw new Error(
        `Failed to insert alert event: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async resolveAlertEvent(id: string, tx?: TransactionContext): Promise<AlertEvent | null> {
    try {
      const now = new Date();
      const rows = await this.executor(tx)
        .update(alertEvents)
        .set({ resolvedAt: now })
        .where(and(eq(alertEvents.id, id), isNull(alertEvents.resolvedAt)))
        .returning();

      const row = rows[0];
      return row ? toAlertEvent(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to resolve alert event "${id}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
