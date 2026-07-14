import type { CursorPaginationOptions, PaginatedResult } from '../../core/pagination.js';
import type { TransactionContext } from '../../core/transaction.js';

export interface User {
  id: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface UserWallet {
  id: string;
  userId: string;
  chainId: number;
  address: string;
  verifiedAt: Date;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface Session {
  id: string;
  userId: string;
  hashedSessionToken: string;
  expiresAt: Date;
  deviceMetadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthRepository {
  getUser(id: string, tx?: TransactionContext): Promise<User | null>;

  getUsers(
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<User>>;

  insertUser(
    user: Omit<User, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>,
    tx?: TransactionContext,
  ): Promise<User>;

  updateUser(
    id: string,
    data: Partial<Omit<User, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>>,
    tx?: TransactionContext,
  ): Promise<User | null>;

  deleteUser(id: string, tx?: TransactionContext): Promise<boolean>;

  getUserWallet(id: string, tx?: TransactionContext): Promise<UserWallet | null>;

  getUserWalletsByUser(userId: string, tx?: TransactionContext): Promise<UserWallet[]>;

  getUserWalletByAddress(
    userId: string,
    chainId: number,
    address: string,
    tx?: TransactionContext,
  ): Promise<UserWallet | null>;

  insertUserWallet(
    userWallet: Omit<UserWallet, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>,
    tx?: TransactionContext,
  ): Promise<UserWallet>;

  deleteUserWallet(id: string, tx?: TransactionContext): Promise<boolean>;

  getSession(id: string, tx?: TransactionContext): Promise<Session | null>;

  getSessionByToken(hashedToken: string, tx?: TransactionContext): Promise<Session | null>;

  getSessionsByUser(userId: string, tx?: TransactionContext): Promise<Session[]>;

  insertSession(
    session: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<Session>;

  revokeSession(id: string, tx?: TransactionContext): Promise<Session | null>;

  revokeAllSessions(userId: string, tx?: TransactionContext): Promise<number>;
}
