import type { CursorPaginationOptions, PaginatedResult } from '../../core/pagination.js';
import type { TransactionContext } from '../../core/transaction.js';

export interface Pool {
  chainId: number;
  address: string;
  protocolId: string;
  token0Address: string;
  token1Address: string;
  feeTier: number;
  createdBlock: bigint;
  createdTxHash: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Swap {
  id: string;
  chainId: number;
  blockNumber: bigint;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
  poolAddress: string;
  sender: string;
  recipient: string;
  amount0Raw: string;
  amount1Raw: string;
  sqrtPriceX96: string;
  liquidity: string;
  tick: number;
  normalizedUsdValue: string | null;
  priceImpactEstimate: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PoolRepository {
  getPool(chainId: number, address: string, tx?: TransactionContext): Promise<Pool | null>;

  getPools(
    chainId: number,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<Pool>>;

  getPoolsByToken(
    chainId: number,
    tokenAddress: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<Pool>>;

  insertPool(pool: Omit<Pool, 'createdAt' | 'updatedAt'>, tx?: TransactionContext): Promise<Pool>;

  upsertPool(pool: Omit<Pool, 'createdAt' | 'updatedAt'>, tx?: TransactionContext): Promise<Pool>;

  updatePool(
    chainId: number,
    address: string,
    data: Partial<Omit<Pool, 'chainId' | 'address' | 'createdAt' | 'updatedAt'>>,
    tx?: TransactionContext,
  ): Promise<Pool | null>;
}

export interface SwapRepository {
  getSwap(id: string, tx?: TransactionContext): Promise<Swap | null>;

  getSwapsByPool(
    chainId: number,
    poolAddress: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<Swap>>;

  getSwapsByTransaction(
    chainId: number,
    transactionHash: string,
    tx?: TransactionContext,
  ): Promise<Swap[]>;

  insertSwap(
    swap: Omit<Swap, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<Swap>;

  insertSwaps(
    swaps: Omit<Swap, 'id' | 'createdAt' | 'updatedAt'>[],
    tx?: TransactionContext,
  ): Promise<Swap[]>;
}
