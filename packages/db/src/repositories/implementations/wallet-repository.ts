import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { Database } from '../../client.js';
import {
  type CursorPaginationOptions,
  type PaginatedResult,
  buildPaginatedResult,
  decodeCursor,
} from '../../core/pagination.js';
import type { TransactionContext } from '../../core/transaction.js';
import { tokenBalances } from '../../schema/contracts-tokens.js';
import { wallets } from '../../schema/wallet-portfolio.js';
import type {
  BalanceRepository,
  TokenBalance,
  Wallet,
  WalletRepository,
} from '../interfaces/wallet-repository.js';

type WalletRow = typeof wallets.$inferSelect;
type TokenBalanceRow = typeof tokenBalances.$inferSelect;

function toWallet(row: WalletRow): Wallet {
  return {
    chainId: row.chainId,
    address: row.address,
    firstSeenBlock: row.firstSeenBlock,
    userOwned: row.userOwned,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toTokenBalance(row: TokenBalanceRow): TokenBalance {
  return {
    chainId: row.chain_id,
    tokenAddress: row.token_address,
    walletAddress: row.wallet_address,
    balanceRaw: row.balance_raw,
    asOfBlock: row.as_of_block,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class DrizzleWalletRepository implements WalletRepository {
  constructor(private readonly db: Database['db']) {}

  private resolve(tx?: TransactionContext): TransactionContext {
    return (tx ?? this.db) as TransactionContext;
  }

  async getWallet(
    chainId: number,
    address: string,
    tx?: TransactionContext,
  ): Promise<Wallet | null> {
    try {
      const rows = await this.resolve(tx)
        .select()
        .from(wallets)
        .where(and(eq(wallets.chainId, chainId), eq(wallets.address, address)))
        .limit(1);

      const row = rows[0];
      return row ? toWallet(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to get wallet ${chainId}:${address}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getWallets(
    chainId: number,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<Wallet>> {
    try {
      const { limit, cursor, orderBy } = options;
      const conditions = [eq(wallets.chainId, chainId)];

      if (cursor) {
        const decodedCursor = decodeCursor(cursor);
        if (orderBy === 'asc') {
          conditions.push(gt(wallets.address, decodedCursor));
        } else {
          conditions.push(lt(wallets.address, decodedCursor));
        }
      }

      const rows = await this.resolve(tx)
        .select()
        .from(wallets)
        .where(and(...conditions))
        .orderBy(orderBy === 'asc' ? wallets.address : sql`${wallets.address} DESC`)
        .limit(limit + 1);

      return buildPaginatedResult(rows.map(toWallet), limit, (w) => w.address);
    } catch (error) {
      throw new Error(
        `Failed to get wallets for chain ${chainId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async insertWallet(
    wallet: Omit<Wallet, 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<Wallet> {
    try {
      const rows = await this.resolve(tx)
        .insert(wallets)
        .values({
          chainId: wallet.chainId,
          address: wallet.address,
          firstSeenBlock: wallet.firstSeenBlock ?? 0n,
          userOwned: wallet.userOwned,
        })
        .returning();

      const row = rows[0];
      if (!row) {
        throw new Error('Insert returned no rows');
      }

      return toWallet(row);
    } catch (error) {
      throw new Error(
        `Failed to insert wallet ${wallet.chainId}:${wallet.address}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async upsertWallet(
    wallet: Omit<Wallet, 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<Wallet> {
    try {
      const firstSeenBlockValue = wallet.firstSeenBlock ?? 0n;
      const rows = await this.resolve(tx)
        .insert(wallets)
        .values({
          chainId: wallet.chainId,
          address: wallet.address,
          firstSeenBlock: firstSeenBlockValue,
          userOwned: wallet.userOwned,
        })
        .onConflictDoUpdate({
          target: [wallets.chainId, wallets.address],
          set: {
            firstSeenBlock: firstSeenBlockValue,
            userOwned: wallet.userOwned,
            updatedAt: new Date(),
          },
        })
        .returning();

      const row = rows[0];
      if (!row) {
        throw new Error('Upsert returned no rows');
      }

      return toWallet(row);
    } catch (error) {
      throw new Error(
        `Failed to upsert wallet ${wallet.chainId}:${wallet.address}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async updateWallet(
    chainId: number,
    address: string,
    data: Partial<Omit<Wallet, 'chainId' | 'address' | 'createdAt' | 'updatedAt'>>,
    tx?: TransactionContext,
  ): Promise<Wallet | null> {
    try {
      const setFields: Record<string, unknown> = { updatedAt: new Date() };

      if (data.firstSeenBlock !== undefined && data.firstSeenBlock !== null) {
        setFields.firstSeenBlock = data.firstSeenBlock;
      }
      if (data.userOwned !== undefined) {
        setFields.userOwned = data.userOwned;
      }

      const rows = await this.resolve(tx)
        .update(wallets)
        .set(setFields)
        .where(and(eq(wallets.chainId, chainId), eq(wallets.address, address)))
        .returning();

      const row = rows[0];
      return row ? toWallet(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to update wallet ${chainId}:${address}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export class DrizzleBalanceRepository implements BalanceRepository {
  constructor(private readonly db: Database['db']) {}

  private resolve(tx?: TransactionContext): TransactionContext {
    return (tx ?? this.db) as TransactionContext;
  }

  async getBalance(
    chainId: number,
    tokenAddress: string,
    walletAddress: string,
    tx?: TransactionContext,
  ): Promise<TokenBalance | null> {
    try {
      const rows = await this.resolve(tx)
        .select()
        .from(tokenBalances)
        .where(
          and(
            eq(tokenBalances.chain_id, chainId),
            eq(tokenBalances.token_address, tokenAddress),
            eq(tokenBalances.wallet_address, walletAddress),
          ),
        )
        .limit(1);

      const row = rows[0];
      return row ? toTokenBalance(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to get balance ${chainId}:${tokenAddress}:${walletAddress}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getBalancesByWallet(
    chainId: number,
    walletAddress: string,
    tx?: TransactionContext,
  ): Promise<TokenBalance[]> {
    try {
      const rows = await this.resolve(tx)
        .select()
        .from(tokenBalances)
        .where(
          and(eq(tokenBalances.chain_id, chainId), eq(tokenBalances.wallet_address, walletAddress)),
        )
        .orderBy(tokenBalances.token_address);

      return rows.map(toTokenBalance);
    } catch (error) {
      throw new Error(
        `Failed to get balances for wallet ${chainId}:${walletAddress}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getBalancesByToken(
    chainId: number,
    tokenAddress: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<TokenBalance>> {
    try {
      const { limit, cursor, orderBy } = options;
      const conditions = [
        eq(tokenBalances.chain_id, chainId),
        eq(tokenBalances.token_address, tokenAddress),
      ];

      if (cursor) {
        const decodedCursor = decodeCursor(cursor);
        if (orderBy === 'asc') {
          conditions.push(gt(tokenBalances.wallet_address, decodedCursor));
        } else {
          conditions.push(lt(tokenBalances.wallet_address, decodedCursor));
        }
      }

      const rows = await this.resolve(tx)
        .select()
        .from(tokenBalances)
        .where(and(...conditions))
        .orderBy(
          orderBy === 'asc'
            ? tokenBalances.wallet_address
            : sql`${tokenBalances.wallet_address} DESC`,
        )
        .limit(limit + 1);

      return buildPaginatedResult(rows.map(toTokenBalance), limit, (b) => b.walletAddress);
    } catch (error) {
      throw new Error(
        `Failed to get balances for token ${chainId}:${tokenAddress}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async insertBalance(
    balance: Omit<TokenBalance, 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<TokenBalance> {
    try {
      const rows = await this.resolve(tx)
        .insert(tokenBalances)
        .values({
          chain_id: balance.chainId,
          token_address: balance.tokenAddress,
          wallet_address: balance.walletAddress,
          balance_raw: balance.balanceRaw,
          as_of_block: balance.asOfBlock,
        })
        .returning();

      const row = rows[0];
      if (!row) {
        throw new Error('Insert returned no rows');
      }

      return toTokenBalance(row);
    } catch (error) {
      throw new Error(
        `Failed to insert balance ${balance.chainId}:${balance.tokenAddress}:${balance.walletAddress}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async upsertBalance(
    balance: Omit<TokenBalance, 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<TokenBalance> {
    try {
      const rows = await this.resolve(tx)
        .insert(tokenBalances)
        .values({
          chain_id: balance.chainId,
          token_address: balance.tokenAddress,
          wallet_address: balance.walletAddress,
          balance_raw: balance.balanceRaw,
          as_of_block: balance.asOfBlock,
        })
        .onConflictDoUpdate({
          target: [
            tokenBalances.chain_id,
            tokenBalances.token_address,
            tokenBalances.wallet_address,
          ],
          set: {
            balance_raw: balance.balanceRaw,
            as_of_block: balance.asOfBlock,
            updated_at: new Date(),
          },
        })
        .returning();

      const row = rows[0];
      if (!row) {
        throw new Error('Upsert returned no rows');
      }

      return toTokenBalance(row);
    } catch (error) {
      throw new Error(
        `Failed to upsert balance ${balance.chainId}:${balance.tokenAddress}:${balance.walletAddress}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async updateBalance(
    chainId: number,
    tokenAddress: string,
    walletAddress: string,
    data: Partial<
      Omit<TokenBalance, 'chainId' | 'tokenAddress' | 'walletAddress' | 'createdAt' | 'updatedAt'>
    >,
    tx?: TransactionContext,
  ): Promise<TokenBalance | null> {
    try {
      const setFields: Record<string, unknown> = { updated_at: new Date() };

      if (data.balanceRaw !== undefined) {
        setFields.balance_raw = data.balanceRaw;
      }
      if (data.asOfBlock !== undefined) {
        setFields.as_of_block = data.asOfBlock;
      }

      const rows = await this.resolve(tx)
        .update(tokenBalances)
        .set(setFields)
        .where(
          and(
            eq(tokenBalances.chain_id, chainId),
            eq(tokenBalances.token_address, tokenAddress),
            eq(tokenBalances.wallet_address, walletAddress),
          ),
        )
        .returning();

      const row = rows[0];
      return row ? toTokenBalance(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to update balance ${chainId}:${tokenAddress}:${walletAddress}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
