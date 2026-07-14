import { and, asc, desc, eq, gt, isNull, lt } from 'drizzle-orm';

import type { Database } from '../../client.js';
import {
  type CursorPaginationOptions,
  type PaginatedResult,
  buildPaginatedResult,
  decodeCursorAsDate,
} from '../../core/index.js';
import type { TransactionContext } from '../../core/transaction.js';
import { sessions, userWallets, users } from '../../schema/auth.js';
import type { AuthRepository, Session, User, UserWallet } from '../interfaces/auth-repository.js';

type UserRow = typeof users.$inferSelect;
type UserWalletRow = typeof userWallets.$inferSelect;
type SessionRow = typeof sessions.$inferSelect;
type UserStatus = (typeof users.$inferInsert)['status'];

function toUser(row: UserRow): User {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

function toUserWallet(row: UserWalletRow): UserWallet {
  return {
    id: row.id,
    userId: row.userId,
    chainId: row.chainId,
    address: row.address,
    verifiedAt: row.verifiedAt ?? row.createdAt,
    isPrimary: row.isPrimary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.userId,
    hashedSessionToken: row.hashedSessionToken,
    expiresAt: row.expiresAt,
    deviceMetadata: row.deviceMetadata,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    revokedAt: row.revokedAt,
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

export class DrizzleAuthRepository implements AuthRepository {
  constructor(private readonly db: Database['db']) {}

  private executor(tx?: TransactionContext) {
    return tx ?? this.db;
  }

  // ─── Users ──────────────────────────────────────────────────────────────────

  async getUser(id: string, tx?: TransactionContext): Promise<User | null> {
    const rows = await this.executor(tx)
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);

    const row = rows[0];
    return row ? toUser(row) : null;
  }

  async getUsers(
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<User>> {
    const { limit, cursor, orderBy } = options;
    const orderFn = orderBy === 'asc' ? asc : desc;
    const cursorCmp = orderBy === 'asc' ? gt : lt;

    const conditions = [isNull(users.deletedAt)];
    if (cursor) {
      conditions.push(cursorCmp(users.createdAt, decodeCursorAsDate(cursor)));
    }

    const rows = await this.executor(tx)
      .select()
      .from(users)
      .where(and(...conditions))
      .orderBy(orderFn(users.createdAt), orderFn(users.id))
      .limit(limit + 1);

    return buildPaginatedResult(rows.map(toUser), limit, (item) => item.createdAt);
  }

  async insertUser(
    user: Omit<User, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>,
    tx?: TransactionContext,
  ): Promise<User> {
    const rows = await this.executor(tx)
      .insert(users)
      .values({ status: user.status as UserStatus })
      .returning();

    return toUser(ensureRow(rows[0], 'insertUser'));
  }

  async updateUser(
    id: string,
    data: Partial<Omit<User, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>>,
    tx?: TransactionContext,
  ): Promise<User | null> {
    const setValues: Record<string, unknown> = { updatedAt: new Date() };
    if (data.status !== undefined) {
      setValues.status = data.status as UserStatus;
    }

    const rows = await this.executor(tx)
      .update(users)
      .set(setValues)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .returning();

    const row = rows[0];
    return row ? toUser(row) : null;
  }

  async deleteUser(id: string, tx?: TransactionContext): Promise<boolean> {
    const now = new Date();
    const rows = await this.executor(tx)
      .update(users)
      .set({ deletedAt: now, status: 'deleted', updatedAt: now })
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .returning();

    return rows.length > 0;
  }

  // ─── User Wallets ──────────────────────────────────────────────────────────

  async getUserWallet(id: string, tx?: TransactionContext): Promise<UserWallet | null> {
    const rows = await this.executor(tx)
      .select()
      .from(userWallets)
      .where(and(eq(userWallets.id, id), isNull(userWallets.deletedAt)))
      .limit(1);

    const row = rows[0];
    return row ? toUserWallet(row) : null;
  }

  async getUserWalletsByUser(userId: string, tx?: TransactionContext): Promise<UserWallet[]> {
    const rows = await this.executor(tx)
      .select()
      .from(userWallets)
      .where(and(eq(userWallets.userId, userId), isNull(userWallets.deletedAt)))
      .orderBy(desc(userWallets.isPrimary), asc(userWallets.createdAt), asc(userWallets.id));

    return rows.map(toUserWallet);
  }

  async getUserWalletByAddress(
    userId: string,
    chainId: number,
    address: string,
    tx?: TransactionContext,
  ): Promise<UserWallet | null> {
    const normalizedAddress = address.toLowerCase();

    const rows = await this.executor(tx)
      .select()
      .from(userWallets)
      .where(
        and(
          eq(userWallets.userId, userId),
          eq(userWallets.chainId, chainId),
          eq(userWallets.address, normalizedAddress),
          isNull(userWallets.deletedAt),
        ),
      )
      .limit(1);

    const row = rows[0];
    return row ? toUserWallet(row) : null;
  }

  async insertUserWallet(
    userWallet: Omit<UserWallet, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>,
    tx?: TransactionContext,
  ): Promise<UserWallet> {
    const rows = await this.executor(tx)
      .insert(userWallets)
      .values({
        userId: userWallet.userId,
        chainId: userWallet.chainId,
        address: userWallet.address.toLowerCase(),
        verifiedAt: userWallet.verifiedAt,
        isPrimary: userWallet.isPrimary,
      })
      .returning();

    return toUserWallet(ensureRow(rows[0], 'insertUserWallet'));
  }

  async deleteUserWallet(id: string, tx?: TransactionContext): Promise<boolean> {
    const now = new Date();
    const rows = await this.executor(tx)
      .update(userWallets)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(userWallets.id, id), isNull(userWallets.deletedAt)))
      .returning();

    return rows.length > 0;
  }

  // ─── Sessions ──────────────────────────────────────────────────────────────

  async getSession(id: string, tx?: TransactionContext): Promise<Session | null> {
    const rows = await this.executor(tx)
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);

    const row = rows[0];
    return row ? toSession(row) : null;
  }

  async getSessionByToken(hashedToken: string, tx?: TransactionContext): Promise<Session | null> {
    const rows = await this.executor(tx)
      .select()
      .from(sessions)
      .where(eq(sessions.hashedSessionToken, hashedToken))
      .limit(1);

    const row = rows[0];
    return row ? toSession(row) : null;
  }

  async getSessionsByUser(userId: string, tx?: TransactionContext): Promise<Session[]> {
    const rows = await this.executor(tx)
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.createdAt), desc(sessions.id));

    return rows.map(toSession);
  }

  async insertSession(
    session: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<Session> {
    const rows = await this.executor(tx)
      .insert(sessions)
      .values({
        userId: session.userId,
        hashedSessionToken: session.hashedSessionToken,
        expiresAt: session.expiresAt,
        deviceMetadata: session.deviceMetadata,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        revokedAt: session.revokedAt,
      })
      .returning();

    return toSession(ensureRow(rows[0], 'insertSession'));
  }

  async revokeSession(id: string, tx?: TransactionContext): Promise<Session | null> {
    const now = new Date();
    const rows = await this.executor(tx)
      .update(sessions)
      .set({ revokedAt: now, updatedAt: now })
      .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
      .returning();

    const row = rows[0];
    return row ? toSession(row) : null;
  }

  async revokeAllSessions(userId: string, tx?: TransactionContext): Promise<number> {
    const now = new Date();
    const rows = await this.executor(tx)
      .update(sessions)
      .set({ revokedAt: now, updatedAt: now })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning();

    return rows.length;
  }
}
