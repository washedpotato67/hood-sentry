import type { CursorPaginationOptions, PaginatedResult } from '../../core/pagination.js';
import type { TransactionContext } from '../../core/transaction.js';

export interface Wallet {
  chainId: number;
  address: string;
  firstSeenBlock: bigint | null;
  userOwned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TokenBalance {
  chainId: number;
  tokenAddress: string;
  walletAddress: string;
  balanceRaw: string;
  asOfBlock: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface WalletRepository {
  getWallet(chainId: number, address: string, tx?: TransactionContext): Promise<Wallet | null>;

  getWallets(
    chainId: number,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<Wallet>>;

  insertWallet(
    wallet: Omit<Wallet, 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<Wallet>;

  upsertWallet(
    wallet: Omit<Wallet, 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<Wallet>;

  updateWallet(
    chainId: number,
    address: string,
    data: Partial<Omit<Wallet, 'chainId' | 'address' | 'createdAt' | 'updatedAt'>>,
    tx?: TransactionContext,
  ): Promise<Wallet | null>;
}

export interface BalanceRepository {
  getBalance(
    chainId: number,
    tokenAddress: string,
    walletAddress: string,
    tx?: TransactionContext,
  ): Promise<TokenBalance | null>;

  getBalancesByWallet(
    chainId: number,
    walletAddress: string,
    tx?: TransactionContext,
  ): Promise<TokenBalance[]>;

  getBalancesByToken(
    chainId: number,
    tokenAddress: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<TokenBalance>>;

  insertBalance(
    balance: Omit<TokenBalance, 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<TokenBalance>;

  upsertBalance(
    balance: Omit<TokenBalance, 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<TokenBalance>;

  updateBalance(
    chainId: number,
    tokenAddress: string,
    walletAddress: string,
    data: Partial<
      Omit<TokenBalance, 'chainId' | 'tokenAddress' | 'walletAddress' | 'createdAt' | 'updatedAt'>
    >,
    tx?: TransactionContext,
  ): Promise<TokenBalance | null>;
}
