import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

const timestamps = {
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const abiSourceEnum = pgEnum('abi_source', ['verified', 'guessed', 'manual']);

export const tokenTypeEnum = pgEnum('token_type', ['erc20', 'erc721', 'erc1155', 'native']);

export const contracts = pgTable(
  'contracts',
  {
    chain_id: integer('chain_id').notNull(),
    address: varchar('address', { length: 42 }).notNull(),
    creator_address: varchar('creator_address', { length: 42 }),
    creation_tx_hash: varchar('creation_tx_hash', { length: 66 }),
    creation_block: bigint('creation_block', { mode: 'bigint' }),
    bytecode_hash: varchar('bytecode_hash', { length: 66 }),
    runtime_bytecode: text('runtime_bytecode'),
    is_proxy: boolean('is_proxy').notNull().default(false),
    proxy_type: varchar('proxy_type', { length: 64 }),
    implementation_address: varchar('implementation_address', { length: 42 }),
    proxy_admin_address: varchar('proxy_admin_address', { length: 42 }),
    verified: boolean('verified').notNull().default(false),
    source_provider: varchar('source_provider', { length: 64 }),
    source_fetched_at: timestamp('source_fetched_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.chain_id, table.address] })],
);

export const contractSources = pgTable(
  'contract_sources',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    chain_id: integer('chain_id').notNull(),
    address: varchar('address', { length: 42 }).notNull(),
    source_code: text('source_code').notNull(),
    compiler_version: varchar('compiler_version', { length: 128 }),
    compiler_settings: jsonb('compiler_settings'),
    abi: jsonb('abi'),
    verified_at: timestamp('verified_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('contract_sources_chain_address_idx').on(table.chain_id, table.address)],
);

export const contractAbis = pgTable(
  'contract_abis',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    chain_id: integer('chain_id').notNull(),
    address: varchar('address', { length: 42 }).notNull(),
    abi: jsonb('abi').notNull(),
    source: abiSourceEnum('source').notNull(),
    ...timestamps,
  },
  (table) => [index('contract_abis_chain_address_idx').on(table.chain_id, table.address)],
);

export const proxyRelationships = pgTable(
  'proxy_relationships',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    chain_id: integer('chain_id').notNull(),
    proxy_address: varchar('proxy_address', { length: 42 }).notNull(),
    implementation_address: varchar('implementation_address', { length: 42 }).notNull(),
    proxy_type: varchar('proxy_type', { length: 64 }).notNull(),
    admin_address: varchar('admin_address', { length: 42 }),
    detected_at: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    index('proxy_relationships_chain_proxy_idx').on(table.chain_id, table.proxy_address),
    index('proxy_relationships_chain_impl_idx').on(table.chain_id, table.implementation_address),
  ],
);

export const tokens = pgTable(
  'tokens',
  {
    chain_id: integer('chain_id').notNull(),
    address: varchar('address', { length: 42 }).notNull(),
    name: varchar('name', { length: 256 }),
    symbol: varchar('symbol', { length: 64 }),
    decimals: integer('decimals'),
    total_supply_raw: numeric('total_supply_raw', { precision: 78, scale: 0 }),
    token_type: tokenTypeEnum('token_type').notNull(),
    canonical_asset_key: varchar('canonical_asset_key', { length: 256 }),
    logo_uri: text('logo_uri'),
    metadata_status: varchar('metadata_status', { length: 32 }).notNull().default('pending'),
    spam_status: varchar('spam_status', { length: 32 }).notNull().default('unknown'),
    first_seen_block: bigint('first_seen_block', { mode: 'bigint' }),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.chain_id, table.address] }),
    index('tokens_symbol_idx').on(table.chain_id, table.symbol),
  ],
);

export const tokenTransfers = pgTable(
  'token_transfers',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    chain_id: integer('chain_id').notNull(),
    block_number: bigint('block_number', { mode: 'bigint' }).notNull(),
    block_hash: varchar('block_hash', { length: 66 }).notNull(),
    transaction_hash: varchar('transaction_hash', { length: 66 }).notNull(),
    log_index: integer('log_index').notNull(),
    token_address: varchar('token_address', { length: 42 }).notNull(),
    from_address: varchar('from_address', { length: 42 }).notNull(),
    to_address: varchar('to_address', { length: 42 }).notNull(),
    amount_raw: numeric('amount_raw', { precision: 78, scale: 0 }).notNull(),
    ui_amount_raw: numeric('ui_amount_raw', { precision: 78, scale: 0 }),
    ...timestamps,
  },
  (table) => [
    index('token_transfers_chain_token_idx').on(table.chain_id, table.token_address),
    index('token_transfers_chain_from_idx').on(table.chain_id, table.from_address),
    index('token_transfers_chain_to_idx').on(table.chain_id, table.to_address),
    index('token_transfers_chain_block_idx').on(table.chain_id, table.block_number),
    index('token_transfers_tx_hash_idx').on(table.transaction_hash),
  ],
);

export const tokenApprovals = pgTable(
  'token_approvals',
  {
    chain_id: integer('chain_id').notNull(),
    owner_address: varchar('owner_address', { length: 42 }).notNull(),
    token_address: varchar('token_address', { length: 42 }).notNull(),
    spender_address: varchar('spender_address', { length: 42 }).notNull(),
    allowance_raw: numeric('allowance_raw', { precision: 78, scale: 0 }).notNull(),
    last_updated_block: bigint('last_updated_block', { mode: 'bigint' }).notNull(),
    ...timestamps,
  },
  (table) => [
    primaryKey({
      columns: [table.chain_id, table.owner_address, table.token_address, table.spender_address],
    }),
  ],
);

export const tokenBalances = pgTable(
  'token_balances',
  {
    chain_id: integer('chain_id').notNull(),
    token_address: varchar('token_address', { length: 42 }).notNull(),
    wallet_address: varchar('wallet_address', { length: 42 }).notNull(),
    balance_raw: numeric('balance_raw', { precision: 78, scale: 0 }).notNull(),
    as_of_block: bigint('as_of_block', { mode: 'bigint' }).notNull(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.chain_id, table.token_address, table.wallet_address] }),
    index('token_balances_wallet_idx').on(table.chain_id, table.wallet_address),
  ],
);

export const holderSnapshots = pgTable(
  'holder_snapshots',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    chain_id: integer('chain_id').notNull(),
    token_address: varchar('token_address', { length: 42 }).notNull(),
    snapshot_block: bigint('snapshot_block', { mode: 'bigint' }).notNull(),
    holder_count: integer('holder_count').notNull(),
    top_10_bps: integer('top_10_bps').notNull(),
    top_20_bps: integer('top_20_bps').notNull(),
    gini_scaled: integer('gini_scaled').notNull(),
    circulating_supply_raw: numeric('circulating_supply_raw', {
      precision: 78,
      scale: 0,
    }).notNull(),
    classification_exclusions: jsonb('classification_exclusions'),
    methodology_version: varchar('methodology_version', { length: 32 }).notNull(),
    ...timestamps,
  },
  (table) => [
    index('holder_snapshots_chain_token_block_idx').on(
      table.chain_id,
      table.token_address,
      table.snapshot_block,
    ),
  ],
);
