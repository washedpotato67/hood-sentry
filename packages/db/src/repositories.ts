import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from './client.js';
import * as schema from './schema/index.js';

export class ChainRepository {
  constructor(private db: Database['db']) {}

  async getChain(chainId: bigint) {
    return this.db.select().from(schema.chains).where(eq(schema.chains.chainId, chainId)).limit(1);
  }

  async getAllChains() {
    return this.db.select().from(schema.chains);
  }

  async getEnabledChains() {
    return this.db.select().from(schema.chains).where(eq(schema.chains.enabled, true));
  }

  async createChain(data: typeof schema.chains.$inferInsert) {
    return this.db.insert(schema.chains).values(data).returning();
  }

  async updateHeadBlock(chainId: bigint, blockNumber: bigint) {
    return this.db
      .update(schema.chains)
      .set({
        headBlockNumber: blockNumber,
        updatedAt: new Date(),
      })
      .where(eq(schema.chains.chainId, chainId))
      .returning();
  }
}

export class BlockRepository {
  constructor(private db: Database['db']) {}

  async getBlock(chainId: bigint, blockNumber: bigint) {
    return this.db
      .select()
      .from(schema.blocks)
      .where(
        and(
          eq(schema.blocks.chainId, chainId),
          eq(schema.blocks.number, blockNumber),
          eq(schema.blocks.canonical, true),
        ),
      )
      .limit(1);
  }

  async getBlockByHash(chainId: bigint, blockHash: string) {
    return this.db
      .select()
      .from(schema.blocks)
      .where(and(eq(schema.blocks.chainId, chainId), eq(schema.blocks.hash, blockHash)))
      .limit(1);
  }

  async insertBlock(data: typeof schema.blocks.$inferInsert) {
    return this.db.insert(schema.blocks).values(data).returning();
  }

  async markBlocksOrphaned(chainId: bigint) {
    return this.db
      .update(schema.blocks)
      .set({ canonical: false, updatedAt: new Date() })
      .where(and(eq(schema.blocks.chainId, chainId), eq(schema.blocks.canonical, true)));
  }
}

export class TransactionRepository {
  constructor(private db: Database['db']) {}

  async getTransaction(chainId: bigint, txHash: string) {
    return this.db
      .select()
      .from(schema.transactions)
      .where(and(eq(schema.transactions.chainId, chainId), eq(schema.transactions.hash, txHash)))
      .limit(1);
  }

  async getTransactionsByBlock(chainId: bigint, blockNumber: bigint) {
    return this.db
      .select()
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.chainId, chainId),
          eq(schema.transactions.blockNumber, blockNumber),
          eq(schema.transactions.canonical, true),
        ),
      );
  }

  async insertTransaction(data: typeof schema.transactions.$inferInsert) {
    return this.db.insert(schema.transactions).values(data).returning();
  }
}

export class TokenRepository {
  constructor(private db: Database['db']) {}

  async getToken(chainId: number, address: string) {
    return this.db
      .select()
      .from(schema.tokens)
      .where(and(eq(schema.tokens.chain_id, chainId), eq(schema.tokens.address, address)))
      .limit(1);
  }

  async getTokensBySymbol(chainId: number, symbol: string) {
    return this.db
      .select()
      .from(schema.tokens)
      .where(and(eq(schema.tokens.chain_id, chainId), eq(schema.tokens.symbol, symbol)));
  }

  async insertToken(data: typeof schema.tokens.$inferInsert) {
    return this.db.insert(schema.tokens).values(data).returning();
  }

  async updateToken(
    chainId: number,
    address: string,
    data: Partial<typeof schema.tokens.$inferInsert>,
  ) {
    return this.db
      .update(schema.tokens)
      .set({ ...data, updated_at: new Date() })
      .where(and(eq(schema.tokens.chain_id, chainId), eq(schema.tokens.address, address)))
      .returning();
  }
}

export class TokenTransferRepository {
  constructor(private db: Database['db']) {}

  async getTransfersByToken(chainId: number, tokenAddress: string, limit = 100) {
    return this.db
      .select()
      .from(schema.tokenTransfers)
      .where(
        and(
          eq(schema.tokenTransfers.chain_id, chainId),
          eq(schema.tokenTransfers.token_address, tokenAddress),
        ),
      )
      .orderBy(schema.tokenTransfers.created_at)
      .limit(limit);
  }

  async insertTransfer(data: typeof schema.tokenTransfers.$inferInsert) {
    return this.db.insert(schema.tokenTransfers).values(data).returning();
  }
}

export class RiskScanRepository {
  constructor(private db: Database['db']) {}

  async getScanRun(scanRunId: string) {
    return this.db
      .select()
      .from(schema.riskScanRuns)
      .where(eq(schema.riskScanRuns.id, scanRunId))
      .limit(1);
  }

  async getScansByTarget(chainId: number, targetAddress: string, limit = 10) {
    return this.db
      .select()
      .from(schema.riskScanRuns)
      .where(
        and(
          eq(schema.riskScanRuns.chainId, chainId),
          eq(schema.riskScanRuns.targetAddress, targetAddress),
        ),
      )
      .orderBy(schema.riskScanRuns.startedAt)
      .limit(limit);
  }

  async insertScanRun(data: typeof schema.riskScanRuns.$inferInsert) {
    return this.db.insert(schema.riskScanRuns).values(data).returning();
  }

  async updateScanRun(scanRunId: string, data: Partial<typeof schema.riskScanRuns.$inferInsert>) {
    return this.db
      .update(schema.riskScanRuns)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.riskScanRuns.id, scanRunId))
      .returning();
  }
}

export class UserRepository {
  constructor(private db: Database['db']) {}

  async getUser(userId: string) {
    return this.db
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), eq(schema.users.status, 'active')))
      .limit(1);
  }

  async createUser(data: typeof schema.users.$inferInsert) {
    return this.db.insert(schema.users).values(data).returning();
  }

  async suspendUser(userId: string) {
    return this.db
      .update(schema.users)
      .set({ status: 'suspended', updatedAt: new Date() })
      .where(eq(schema.users.id, userId))
      .returning();
  }
}

export class WatchlistRepository {
  constructor(private db: Database['db']) {}

  async getWatchlist(watchlistId: string) {
    return this.db
      .select()
      .from(schema.watchlists)
      .where(and(eq(schema.watchlists.id, watchlistId), isNull(schema.watchlists.deletedAt)))
      .limit(1);
  }

  async getUserWatchlists(userId: string) {
    return this.db
      .select()
      .from(schema.watchlists)
      .where(and(eq(schema.watchlists.userId, userId), isNull(schema.watchlists.deletedAt)));
  }

  async createWatchlist(data: typeof schema.watchlists.$inferInsert) {
    return this.db.insert(schema.watchlists).values(data).returning();
  }

  async deleteWatchlist(watchlistId: string) {
    return this.db
      .update(schema.watchlists)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.watchlists.id, watchlistId))
      .returning();
  }
}
