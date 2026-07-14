import type { CursorPaginationOptions, PaginatedResult } from '../../core/pagination.js';
import type { TransactionContext } from '../../core/transaction.js';

export interface Token {
  chainId: number;
  address: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupplyRaw: string | null;
  tokenType: string;
  canonicalAssetKey: string | null;
  logoUri: string | null;
  metadataStatus: string;
  spamStatus: string;
  firstSeenBlock: bigint | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Contract {
  chainId: number;
  address: string;
  creatorAddress: string | null;
  creationTxHash: string | null;
  creationBlock: bigint | null;
  bytecodeHash: string | null;
  runtimeBytecode: string | null;
  isProxy: boolean;
  proxyType: string | null;
  implementationAddress: string | null;
  proxyAdminAddress: string | null;
  verified: boolean;
  sourceProvider: string | null;
  sourceFetchedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TokenRepository {
  getToken(chainId: number, address: string, tx?: TransactionContext): Promise<Token | null>;

  getTokensBySymbol(chainId: number, symbol: string, tx?: TransactionContext): Promise<Token[]>;

  getTokens(
    chainId: number,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<Token>>;

  insertToken(
    token: Omit<Token, 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<Token>;

  upsertToken(
    token: Omit<Token, 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<Token>;

  updateToken(
    chainId: number,
    address: string,
    data: Partial<Omit<Token, 'chainId' | 'address' | 'createdAt' | 'updatedAt'>>,
    tx?: TransactionContext,
  ): Promise<Token | null>;
}

export interface ContractRepository {
  getContract(chainId: number, address: string, tx?: TransactionContext): Promise<Contract | null>;

  getContracts(
    chainId: number,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<Contract>>;

  getContractsByCreator(
    chainId: number,
    creatorAddress: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<Contract>>;

  insertContract(
    contract: Omit<Contract, 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<Contract>;

  upsertContract(
    contract: Omit<Contract, 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<Contract>;

  updateContract(
    chainId: number,
    address: string,
    data: Partial<Omit<Contract, 'chainId' | 'address' | 'createdAt' | 'updatedAt'>>,
    tx?: TransactionContext,
  ): Promise<Contract | null>;
}
