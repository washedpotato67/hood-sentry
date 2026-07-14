import type { CursorPaginationOptions, PaginatedResult } from '../../core/pagination.js';
import type { TransactionContext } from '../../core/transaction.js';

export interface AlertRule {
  id: string;
  userId: string;
  chainId: number;
  targetAddress: string;
  ruleType: string;
  condition: unknown;
  channels: unknown;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface AlertEvent {
  id: string;
  alertRuleId: string;
  chainId: number;
  blockNumber: bigint;
  transactionHash: string | null;
  triggeredAt: Date;
  severity: string;
  metadata: unknown;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AlertRepository {
  getAlertRule(id: string, tx?: TransactionContext): Promise<AlertRule | null>;

  getAlertRulesByUser(
    userId: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<AlertRule>>;

  getAlertRulesByTarget(
    chainId: number,
    targetAddress: string,
    tx?: TransactionContext,
  ): Promise<AlertRule[]>;

  insertAlertRule(
    alertRule: Omit<AlertRule, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>,
    tx?: TransactionContext,
  ): Promise<AlertRule>;

  updateAlertRule(
    id: string,
    data: Partial<Omit<AlertRule, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>>,
    tx?: TransactionContext,
  ): Promise<AlertRule | null>;

  deleteAlertRule(id: string, tx?: TransactionContext): Promise<boolean>;

  getAlertEvent(id: string, tx?: TransactionContext): Promise<AlertEvent | null>;

  getAlertEventsByRule(
    alertRuleId: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<AlertEvent>>;

  getUnresolvedAlertEvents(chainId: number, tx?: TransactionContext): Promise<AlertEvent[]>;

  insertAlertEvent(
    alertEvent: Omit<AlertEvent, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<AlertEvent>;

  resolveAlertEvent(id: string, tx?: TransactionContext): Promise<AlertEvent | null>;
}
