import { and, asc, desc, eq, gt, lt, or } from 'drizzle-orm';
import type { Database } from '../../client.js';
import {
  type CursorPaginationOptions,
  type PaginatedResult,
  buildPaginatedResult,
  decodeCursor,
  encodeCursor,
} from '../../core/pagination.js';
import type { TransactionContext } from '../../core/transaction.js';
import { pools, swaps } from '../../schema/dex-market.js';
import type {
  PoolRepository as IPoolRepository,
  SwapRepository as ISwapRepository,
  Pool,
  Swap,
} from '../interfaces/pool-repository.js';

function mapPoolRow(row: typeof pools.$inferSelect): Pool {
  return {
    chainId: row.chain_id,
    address: row.address,
    protocolId: row.protocol_id,
    token0Address: row.token0_address,
    token1Address: row.token1_address,
    feeTier: row.fee_tier,
    createdBlock: row.created_block,
    createdTxHash: row.created_tx_hash,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSwapRow(row: typeof swaps.$inferSelect): Swap {
  return {
    id: row.id,
    chainId: row.chain_id,
    blockNumber: row.block_number,
    blockHash: row.block_hash,
    transactionHash: row.transaction_hash,
    logIndex: row.log_index,
    poolAddress: row.pool_address,
    sender: row.sender,
    recipient: row.recipient,
    amount0Raw: row.amount0_raw,
    amount1Raw: row.amount1_raw,
    sqrtPriceX96: row.sqrt_price_x96,
    liquidity: row.liquidity,
    tick: row.tick,
    normalizedUsdValue: row.normalized_usd_value,
    priceImpactEstimate: row.price_impact_estimate,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PoolRepository implements IPoolRepository {
  constructor(private readonly db: Database['db']) {}

  async getPool(chainId: number, address: string, tx?: TransactionContext): Promise<Pool | null> {
    const client = tx ?? this.db;
    const result = await client
      .select()
      .from(pools)
      .where(and(eq(pools.chain_id, chainId), eq(pools.address, address)))
      .limit(1);

    const row = result[0];
    return row ? mapPoolRow(row) : null;
  }

  async getPools(
    chainId: number,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<Pool>> {
    const client = tx ?? this.db;
    const { limit, cursor, orderBy } = options;

    const conditions = [eq(pools.chain_id, chainId)];

    if (cursor) {
      const decodedCursor = decodeCursor(cursor);
      if (orderBy === 'asc') {
        conditions.push(gt(pools.address, decodedCursor));
      } else {
        conditions.push(lt(pools.address, decodedCursor));
      }
    }

    const orderFn = orderBy === 'asc' ? asc : desc;
    const result = await client
      .select()
      .from(pools)
      .where(and(...conditions))
      .orderBy(orderFn(pools.address))
      .limit(limit + 1);

    const mapped = result.map(mapPoolRow);
    return buildPaginatedResult(mapped, limit, (item) => encodeCursor(item.address));
  }

  async getPoolsByToken(
    chainId: number,
    tokenAddress: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<Pool>> {
    const client = tx ?? this.db;
    const { limit, cursor, orderBy } = options;

    const conditions = [
      eq(pools.chain_id, chainId),
      or(eq(pools.token0_address, tokenAddress), eq(pools.token1_address, tokenAddress)),
    ];

    if (cursor) {
      const decodedCursor = decodeCursor(cursor);
      if (orderBy === 'asc') {
        conditions.push(gt(pools.address, decodedCursor));
      } else {
        conditions.push(lt(pools.address, decodedCursor));
      }
    }

    const orderFn = orderBy === 'asc' ? asc : desc;
    const result = await client
      .select()
      .from(pools)
      .where(and(...conditions))
      .orderBy(orderFn(pools.address))
      .limit(limit + 1);

    const mapped = result.map(mapPoolRow);
    return buildPaginatedResult(mapped, limit, (item) => encodeCursor(item.address));
  }

  async insertPool(
    pool: Omit<Pool, 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<Pool> {
    const client = tx ?? this.db;
    const result = await client
      .insert(pools)
      .values({
        chain_id: pool.chainId,
        address: pool.address,
        protocol_id: pool.protocolId,
        token0_address: pool.token0Address,
        token1_address: pool.token1Address,
        fee_tier: pool.feeTier,
        created_block: pool.createdBlock,
        created_tx_hash: pool.createdTxHash,
        active: pool.active,
      })
      .returning();

    const row = result[0];
    if (!row) {
      throw new Error('insertPool: no row returned');
    }
    return mapPoolRow(row);
  }

  async upsertPool(
    pool: Omit<Pool, 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<Pool> {
    const client = tx ?? this.db;
    const result = await client
      .insert(pools)
      .values({
        chain_id: pool.chainId,
        address: pool.address,
        protocol_id: pool.protocolId,
        token0_address: pool.token0Address,
        token1_address: pool.token1Address,
        fee_tier: pool.feeTier,
        created_block: pool.createdBlock,
        created_tx_hash: pool.createdTxHash,
        active: pool.active,
      })
      .onConflictDoUpdate({
        target: [pools.chain_id, pools.address],
        set: {
          protocol_id: pool.protocolId,
          token0_address: pool.token0Address,
          token1_address: pool.token1Address,
          fee_tier: pool.feeTier,
          created_block: pool.createdBlock,
          created_tx_hash: pool.createdTxHash,
          active: pool.active,
          updated_at: new Date(),
        },
      })
      .returning();

    const row = result[0];
    if (!row) {
      throw new Error('upsertPool: no row returned');
    }
    return mapPoolRow(row);
  }

  async updatePool(
    chainId: number,
    address: string,
    data: Partial<Omit<Pool, 'chainId' | 'address' | 'createdAt' | 'updatedAt'>>,
    tx?: TransactionContext,
  ): Promise<Pool | null> {
    const client = tx ?? this.db;
    const setValues: Record<string, unknown> = { updated_at: new Date() };

    if (data.protocolId !== undefined) setValues.protocol_id = data.protocolId;
    if (data.token0Address !== undefined) setValues.token0_address = data.token0Address;
    if (data.token1Address !== undefined) setValues.token1_address = data.token1Address;
    if (data.feeTier !== undefined) setValues.fee_tier = data.feeTier;
    if (data.createdBlock !== undefined) setValues.created_block = data.createdBlock;
    if (data.createdTxHash !== undefined) setValues.created_tx_hash = data.createdTxHash;
    if (data.active !== undefined) setValues.active = data.active;

    const result = await client
      .update(pools)
      .set(setValues)
      .where(and(eq(pools.chain_id, chainId), eq(pools.address, address)))
      .returning();

    const row = result[0];
    return row ? mapPoolRow(row) : null;
  }
}

export class SwapRepository implements ISwapRepository {
  constructor(private readonly db: Database['db']) {}

  async getSwap(id: string, tx?: TransactionContext): Promise<Swap | null> {
    const client = tx ?? this.db;
    const result = await client.select().from(swaps).where(eq(swaps.id, id)).limit(1);

    const row = result[0];
    return row ? mapSwapRow(row) : null;
  }

  async getSwapsByPool(
    chainId: number,
    poolAddress: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<Swap>> {
    const client = tx ?? this.db;
    const { limit, cursor, orderBy } = options;

    const conditions = [eq(swaps.chain_id, chainId), eq(swaps.pool_address, poolAddress)];

    if (cursor) {
      const decodedCursor = decodeCursor(cursor);
      if (orderBy === 'asc') {
        conditions.push(gt(swaps.id, decodedCursor));
      } else {
        conditions.push(lt(swaps.id, decodedCursor));
      }
    }

    const orderFn = orderBy === 'asc' ? asc : desc;
    const result = await client
      .select()
      .from(swaps)
      .where(and(...conditions))
      .orderBy(orderFn(swaps.id))
      .limit(limit + 1);

    const mapped = result.map(mapSwapRow);
    return buildPaginatedResult(mapped, limit, (item) => encodeCursor(item.id));
  }

  async getSwapsByTransaction(
    chainId: number,
    transactionHash: string,
    tx?: TransactionContext,
  ): Promise<Swap[]> {
    const client = tx ?? this.db;
    const result = await client
      .select()
      .from(swaps)
      .where(and(eq(swaps.chain_id, chainId), eq(swaps.transaction_hash, transactionHash)))
      .orderBy(asc(swaps.log_index));

    return result.map(mapSwapRow);
  }

  async insertSwap(
    swap: Omit<Swap, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<Swap> {
    const client = tx ?? this.db;
    const result = await client
      .insert(swaps)
      .values({
        chain_id: swap.chainId,
        block_number: swap.blockNumber,
        block_hash: swap.blockHash,
        transaction_hash: swap.transactionHash,
        log_index: swap.logIndex,
        pool_address: swap.poolAddress,
        sender: swap.sender,
        recipient: swap.recipient,
        amount0_raw: swap.amount0Raw,
        amount1_raw: swap.amount1Raw,
        sqrt_price_x96: swap.sqrtPriceX96,
        liquidity: swap.liquidity,
        tick: swap.tick,
        normalized_usd_value: swap.normalizedUsdValue,
        price_impact_estimate: swap.priceImpactEstimate,
      })
      .returning();

    const row = result[0];
    if (!row) {
      throw new Error('insertSwap: no row returned');
    }
    return mapSwapRow(row);
  }

  async insertSwaps(
    swapEntries: Omit<Swap, 'id' | 'createdAt' | 'updatedAt'>[],
    tx?: TransactionContext,
  ): Promise<Swap[]> {
    if (swapEntries.length === 0) {
      return [];
    }

    const client = tx ?? this.db;
    const result = await client
      .insert(swaps)
      .values(
        swapEntries.map((swap) => ({
          chain_id: swap.chainId,
          block_number: swap.blockNumber,
          block_hash: swap.blockHash,
          transaction_hash: swap.transactionHash,
          log_index: swap.logIndex,
          pool_address: swap.poolAddress,
          sender: swap.sender,
          recipient: swap.recipient,
          amount0_raw: swap.amount0Raw,
          amount1_raw: swap.amount1Raw,
          sqrt_price_x96: swap.sqrtPriceX96,
          liquidity: swap.liquidity,
          tick: swap.tick,
          normalized_usd_value: swap.normalizedUsdValue,
          price_impact_estimate: swap.priceImpactEstimate,
        })),
      )
      .onConflictDoNothing({
        target: [swaps.chain_id, swaps.transaction_hash, swaps.log_index],
      })
      .returning();

    return result.map(mapSwapRow);
  }
}
