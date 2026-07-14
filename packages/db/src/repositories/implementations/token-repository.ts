import { and, eq, gt, lt } from 'drizzle-orm';
import type { Database } from '../../client.js';
import {
  type CursorPaginationOptions,
  type PaginatedResult,
  buildPaginatedResult,
  decodeCursor,
  encodeCursor,
} from '../../core/pagination.js';
import type { TransactionContext } from '../../core/transaction.js';
import { contracts, tokens } from '../../schema/contracts-tokens.js';
import type {
  Contract,
  ContractRepository as IContractRepository,
  TokenRepository as ITokenRepository,
  Token,
} from '../interfaces/token-repository.js';

function mapTokenRow(row: typeof tokens.$inferSelect): Token {
  return {
    chainId: row.chain_id,
    address: row.address,
    name: row.name,
    symbol: row.symbol,
    decimals: row.decimals,
    totalSupplyRaw: row.total_supply_raw,
    tokenType: row.token_type,
    canonicalAssetKey: row.canonical_asset_key,
    logoUri: row.logo_uri,
    metadataStatus: row.metadata_status,
    spamStatus: row.spam_status,
    firstSeenBlock: row.first_seen_block,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapContractRow(row: typeof contracts.$inferSelect): Contract {
  return {
    chainId: row.chain_id,
    address: row.address,
    creatorAddress: row.creator_address,
    creationTxHash: row.creation_tx_hash,
    creationBlock: row.creation_block,
    bytecodeHash: row.bytecode_hash,
    runtimeBytecode: row.runtime_bytecode,
    isProxy: row.is_proxy,
    proxyType: row.proxy_type,
    implementationAddress: row.implementation_address,
    proxyAdminAddress: row.proxy_admin_address,
    verified: row.verified,
    sourceProvider: row.source_provider,
    sourceFetchedAt: row.source_fetched_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class TokenRepository implements ITokenRepository {
  constructor(private db: Database['db']) {}

  async getToken(chainId: number, address: string, tx?: TransactionContext): Promise<Token | null> {
    const client = tx ?? this.db;
    const result = await client
      .select()
      .from(tokens)
      .where(and(eq(tokens.chain_id, chainId), eq(tokens.address, address)))
      .limit(1);

    const row = result[0];
    return row ? mapTokenRow(row) : null;
  }

  async getTokensBySymbol(
    chainId: number,
    symbol: string,
    tx?: TransactionContext,
  ): Promise<Token[]> {
    const client = tx ?? this.db;
    const result = await client
      .select()
      .from(tokens)
      .where(and(eq(tokens.chain_id, chainId), eq(tokens.symbol, symbol)))
      .orderBy(tokens.address);

    return result.map(mapTokenRow);
  }

  async getTokens(
    chainId: number,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<Token>> {
    const client = tx ?? this.db;
    const { limit, cursor, orderBy } = options;

    const conditions = [eq(tokens.chain_id, chainId)];

    if (cursor) {
      const decodedCursor = decodeCursor(cursor);
      if (orderBy === 'asc') {
        conditions.push(gt(tokens.address, decodedCursor));
      } else {
        conditions.push(lt(tokens.address, decodedCursor));
      }
    }

    const result = await client
      .select()
      .from(tokens)
      .where(and(...conditions))
      .orderBy(orderBy === 'asc' ? tokens.address : tokens.address)
      .limit(limit + 1);

    const mapped = result.map(mapTokenRow);
    return buildPaginatedResult(mapped, limit, (item) => encodeCursor(item.address));
  }

  async insertToken(
    token: Omit<Token, 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<Token> {
    const client = tx ?? this.db;
    const result = await client
      .insert(tokens)
      .values({
        chain_id: token.chainId,
        address: token.address,
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        total_supply_raw: token.totalSupplyRaw,
        token_type: token.tokenType as 'erc20' | 'erc721' | 'erc1155' | 'native',
        canonical_asset_key: token.canonicalAssetKey,
        logo_uri: token.logoUri,
        metadata_status: token.metadataStatus,
        spam_status: token.spamStatus,
        first_seen_block: token.firstSeenBlock,
      })
      .returning();

    const row = result[0];
    if (!row) {
      throw new Error('Failed to insert token');
    }
    return mapTokenRow(row);
  }

  async upsertToken(
    token: Omit<Token, 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<Token> {
    const client = tx ?? this.db;
    const now = new Date();
    const result = await client
      .insert(tokens)
      .values({
        chain_id: token.chainId,
        address: token.address,
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        total_supply_raw: token.totalSupplyRaw,
        token_type: token.tokenType as 'erc20' | 'erc721' | 'erc1155' | 'native',
        canonical_asset_key: token.canonicalAssetKey,
        logo_uri: token.logoUri,
        metadata_status: token.metadataStatus,
        spam_status: token.spamStatus,
        first_seen_block: token.firstSeenBlock,
      })
      .onConflictDoUpdate({
        target: [tokens.chain_id, tokens.address],
        set: {
          name: token.name,
          symbol: token.symbol,
          decimals: token.decimals,
          total_supply_raw: token.totalSupplyRaw,
          token_type: token.tokenType as 'erc20' | 'erc721' | 'erc1155' | 'native',
          canonical_asset_key: token.canonicalAssetKey,
          logo_uri: token.logoUri,
          metadata_status: token.metadataStatus,
          spam_status: token.spamStatus,
          first_seen_block: token.firstSeenBlock,
          updated_at: now,
        },
      })
      .returning();

    const row = result[0];
    if (!row) {
      throw new Error('Failed to upsert token');
    }
    return mapTokenRow(row);
  }

  async updateToken(
    chainId: number,
    address: string,
    data: Partial<Omit<Token, 'chainId' | 'address' | 'createdAt' | 'updatedAt'>>,
    tx?: TransactionContext,
  ): Promise<Token | null> {
    const client = tx ?? this.db;
    const setValues: Record<string, unknown> = { updated_at: new Date() };

    if (data.name !== undefined) setValues.name = data.name;
    if (data.symbol !== undefined) setValues.symbol = data.symbol;
    if (data.decimals !== undefined) setValues.decimals = data.decimals;
    if (data.totalSupplyRaw !== undefined) setValues.total_supply_raw = data.totalSupplyRaw;
    if (data.tokenType !== undefined) setValues.token_type = data.tokenType;
    if (data.canonicalAssetKey !== undefined)
      setValues.canonical_asset_key = data.canonicalAssetKey;
    if (data.logoUri !== undefined) setValues.logo_uri = data.logoUri;
    if (data.metadataStatus !== undefined) setValues.metadata_status = data.metadataStatus;
    if (data.spamStatus !== undefined) setValues.spam_status = data.spamStatus;
    if (data.firstSeenBlock !== undefined) setValues.first_seen_block = data.firstSeenBlock;

    const result = await client
      .update(tokens)
      .set(setValues)
      .where(and(eq(tokens.chain_id, chainId), eq(tokens.address, address)))
      .returning();

    const row = result[0];
    return row ? mapTokenRow(row) : null;
  }
}

export class ContractRepository implements IContractRepository {
  constructor(private db: Database['db']) {}

  async getContract(
    chainId: number,
    address: string,
    tx?: TransactionContext,
  ): Promise<Contract | null> {
    const client = tx ?? this.db;
    const result = await client
      .select()
      .from(contracts)
      .where(and(eq(contracts.chain_id, chainId), eq(contracts.address, address)))
      .limit(1);

    const row = result[0];
    return row ? mapContractRow(row) : null;
  }

  async getContracts(
    chainId: number,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<Contract>> {
    const client = tx ?? this.db;
    const { limit, cursor, orderBy } = options;

    const conditions = [eq(contracts.chain_id, chainId)];

    if (cursor) {
      const decodedCursor = decodeCursor(cursor);
      if (orderBy === 'asc') {
        conditions.push(gt(contracts.address, decodedCursor));
      } else {
        conditions.push(lt(contracts.address, decodedCursor));
      }
    }

    const result = await client
      .select()
      .from(contracts)
      .where(and(...conditions))
      .orderBy(orderBy === 'asc' ? contracts.address : contracts.address)
      .limit(limit + 1);

    const mapped = result.map(mapContractRow);
    return buildPaginatedResult(mapped, limit, (item) => encodeCursor(item.address));
  }

  async getContractsByCreator(
    chainId: number,
    creatorAddress: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<Contract>> {
    const client = tx ?? this.db;
    const { limit, cursor, orderBy } = options;

    const conditions = [
      eq(contracts.chain_id, chainId),
      eq(contracts.creator_address, creatorAddress),
    ];

    if (cursor) {
      const decodedCursor = decodeCursor(cursor);
      if (orderBy === 'asc') {
        conditions.push(gt(contracts.address, decodedCursor));
      } else {
        conditions.push(lt(contracts.address, decodedCursor));
      }
    }

    const result = await client
      .select()
      .from(contracts)
      .where(and(...conditions))
      .orderBy(orderBy === 'asc' ? contracts.address : contracts.address)
      .limit(limit + 1);

    const mapped = result.map(mapContractRow);
    return buildPaginatedResult(mapped, limit, (item) => encodeCursor(item.address));
  }

  async insertContract(
    contract: Omit<Contract, 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<Contract> {
    const client = tx ?? this.db;
    const result = await client
      .insert(contracts)
      .values({
        chain_id: contract.chainId,
        address: contract.address,
        creator_address: contract.creatorAddress,
        creation_tx_hash: contract.creationTxHash,
        creation_block: contract.creationBlock,
        bytecode_hash: contract.bytecodeHash,
        runtime_bytecode: contract.runtimeBytecode,
        is_proxy: contract.isProxy,
        proxy_type: contract.proxyType,
        implementation_address: contract.implementationAddress,
        proxy_admin_address: contract.proxyAdminAddress,
        verified: contract.verified,
        source_provider: contract.sourceProvider,
        source_fetched_at: contract.sourceFetchedAt,
      })
      .returning();

    const row = result[0];
    if (!row) {
      throw new Error('Failed to insert contract');
    }
    return mapContractRow(row);
  }

  async upsertContract(
    contract: Omit<Contract, 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<Contract> {
    const client = tx ?? this.db;
    const now = new Date();
    const result = await client
      .insert(contracts)
      .values({
        chain_id: contract.chainId,
        address: contract.address,
        creator_address: contract.creatorAddress,
        creation_tx_hash: contract.creationTxHash,
        creation_block: contract.creationBlock,
        bytecode_hash: contract.bytecodeHash,
        runtime_bytecode: contract.runtimeBytecode,
        is_proxy: contract.isProxy,
        proxy_type: contract.proxyType,
        implementation_address: contract.implementationAddress,
        proxy_admin_address: contract.proxyAdminAddress,
        verified: contract.verified,
        source_provider: contract.sourceProvider,
        source_fetched_at: contract.sourceFetchedAt,
      })
      .onConflictDoUpdate({
        target: [contracts.chain_id, contracts.address],
        set: {
          creator_address: contract.creatorAddress,
          creation_tx_hash: contract.creationTxHash,
          creation_block: contract.creationBlock,
          bytecode_hash: contract.bytecodeHash,
          runtime_bytecode: contract.runtimeBytecode,
          is_proxy: contract.isProxy,
          proxy_type: contract.proxyType,
          implementation_address: contract.implementationAddress,
          proxy_admin_address: contract.proxyAdminAddress,
          verified: contract.verified,
          source_provider: contract.sourceProvider,
          source_fetched_at: contract.sourceFetchedAt,
          updated_at: now,
        },
      })
      .returning();

    const row = result[0];
    if (!row) {
      throw new Error('Failed to upsert contract');
    }
    return mapContractRow(row);
  }

  async updateContract(
    chainId: number,
    address: string,
    data: Partial<Omit<Contract, 'chainId' | 'address' | 'createdAt' | 'updatedAt'>>,
    tx?: TransactionContext,
  ): Promise<Contract | null> {
    const client = tx ?? this.db;
    const setValues: Record<string, unknown> = { updated_at: new Date() };

    if (data.creatorAddress !== undefined) setValues.creator_address = data.creatorAddress;
    if (data.creationTxHash !== undefined) setValues.creation_tx_hash = data.creationTxHash;
    if (data.creationBlock !== undefined) setValues.creation_block = data.creationBlock;
    if (data.bytecodeHash !== undefined) setValues.bytecode_hash = data.bytecodeHash;
    if (data.runtimeBytecode !== undefined) setValues.runtime_bytecode = data.runtimeBytecode;
    if (data.isProxy !== undefined) setValues.is_proxy = data.isProxy;
    if (data.proxyType !== undefined) setValues.proxy_type = data.proxyType;
    if (data.implementationAddress !== undefined)
      setValues.implementation_address = data.implementationAddress;
    if (data.proxyAdminAddress !== undefined)
      setValues.proxy_admin_address = data.proxyAdminAddress;
    if (data.verified !== undefined) setValues.verified = data.verified;
    if (data.sourceProvider !== undefined) setValues.source_provider = data.sourceProvider;
    if (data.sourceFetchedAt !== undefined) setValues.source_fetched_at = data.sourceFetchedAt;

    const result = await client
      .update(contracts)
      .set(setValues)
      .where(and(eq(contracts.chain_id, chainId), eq(contracts.address, address)))
      .returning();

    const row = result[0];
    return row ? mapContractRow(row) : null;
  }
}
