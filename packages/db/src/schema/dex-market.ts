import {
  bigint,
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamps = {
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

// ─── Enums ───────────────────────────────────────────────────────────────────

export const liquidityEventType = pgEnum('liquidity_event_type', ['mint', 'burn', 'add', 'remove']);

export const marketDataSourceType = pgEnum('market_data_source_type', [
  'rest_api',
  'websocket',
  'subgraph',
  'rpc',
  'csv',
]);

// ─── Raw chain data ─────────────────────────────────────────────────────────

export const dexProtocols = pgTable(
  'dex_protocols',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chain_id: integer('chain_id').notNull(),
    protocol_name: text('protocol_name').notNull(),
    version: text('version').notNull(),
    factory_address: text('factory_address').notNull(),
    router_address: text('router_address'),
    quoter_address: text('quoter_address'),
    verification_source: text('verification_source').notNull(),
    verification_date: timestamp('verification_date', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('dex_protocols_chain_name_version_idx').on(
      table.chain_id,
      table.protocol_name,
      table.version,
    ),
  ],
);

export const pools = pgTable(
  'pools',
  {
    chain_id: integer('chain_id').notNull(),
    address: text('address').notNull(),
    protocol_id: uuid('protocol_id')
      .notNull()
      .references(() => dexProtocols.id),
    token0_address: text('token0_address').notNull(),
    token1_address: text('token1_address').notNull(),
    fee_tier: integer('fee_tier').notNull(),
    created_block: bigint('created_block', { mode: 'bigint' }).notNull(),
    created_tx_hash: text('created_tx_hash').notNull(),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.chain_id, table.address] }),
    index('pools_protocol_id_idx').on(table.protocol_id),
    index('pools_token0_idx').on(table.chain_id, table.token0_address),
    index('pools_token1_idx').on(table.chain_id, table.token1_address),
  ],
);

export const poolTokens = pgTable(
  'pool_tokens',
  {
    chain_id: integer('chain_id').notNull(),
    pool_address: text('pool_address').notNull(),
    token_address: text('token_address').notNull(),
    reserve_raw: numeric('reserve_raw', { precision: 78, scale: 0 }).notNull(),
    weight: numeric('weight'),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.chain_id, table.pool_address, table.token_address] }),
    index('pool_tokens_token_idx').on(table.chain_id, table.token_address),
  ],
);

export const swaps = pgTable(
  'swaps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chain_id: integer('chain_id').notNull(),
    block_number: bigint('block_number', { mode: 'bigint' }).notNull(),
    block_hash: text('block_hash').notNull(),
    transaction_hash: text('transaction_hash').notNull(),
    log_index: integer('log_index').notNull(),
    pool_address: text('pool_address').notNull(),
    sender: text('sender').notNull(),
    recipient: text('recipient').notNull(),
    amount0_raw: numeric('amount0_raw', { precision: 78, scale: 0 }).notNull(),
    amount1_raw: numeric('amount1_raw', { precision: 78, scale: 0 }).notNull(),
    sqrt_price_x96: numeric('sqrt_price_x96', { precision: 78, scale: 0 }).notNull(),
    liquidity: numeric('liquidity', { precision: 78, scale: 0 }).notNull(),
    tick: integer('tick').notNull(),
    normalized_usd_value: numeric('normalized_usd_value', { precision: 38, scale: 18 }),
    price_impact_estimate: numeric('price_impact_estimate', { precision: 38, scale: 18 }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('swaps_chain_tx_log_idx').on(
      table.chain_id,
      table.transaction_hash,
      table.log_index,
    ),
    index('swaps_pool_block_idx').on(table.chain_id, table.pool_address, table.block_number),
    index('swaps_sender_idx').on(table.chain_id, table.sender),
    index('swaps_block_number_idx').on(table.chain_id, table.block_number),
  ],
);

export const liquidityEvents = pgTable(
  'liquidity_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chain_id: integer('chain_id').notNull(),
    block_number: bigint('block_number', { mode: 'bigint' }).notNull(),
    block_hash: text('block_hash').notNull(),
    transaction_hash: text('transaction_hash').notNull(),
    log_index: integer('log_index').notNull(),
    pool_address: text('pool_address').notNull(),
    event_type: liquidityEventType('event_type').notNull(),
    provider_address: text('provider_address').notNull(),
    owner_address: text('owner_address').notNull(),
    token0_amount_raw: numeric('token0_amount_raw', { precision: 78, scale: 0 }).notNull(),
    token1_amount_raw: numeric('token1_amount_raw', { precision: 78, scale: 0 }).notNull(),
    usd_estimate: numeric('usd_estimate', { precision: 38, scale: 18 }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('liquidity_events_chain_tx_log_idx').on(
      table.chain_id,
      table.transaction_hash,
      table.log_index,
    ),
    index('liquidity_events_pool_block_idx').on(
      table.chain_id,
      table.pool_address,
      table.block_number,
    ),
    index('liquidity_events_provider_idx').on(table.chain_id, table.provider_address),
    index('liquidity_events_event_type_idx').on(table.chain_id, table.event_type),
  ],
);

export const priceObservations = pgTable(
  'price_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chain_id: integer('chain_id').notNull(),
    asset_key: text('asset_key').notNull(),
    source: text('source').notNull(),
    price_raw: numeric('price_raw', { precision: 78, scale: 0 }).notNull(),
    decimals: integer('decimals').notNull(),
    observed_at: timestamp('observed_at', { withTimezone: true }).notNull(),
    source_timestamp: timestamp('source_timestamp', { withTimezone: true }),
    stale: boolean('stale').notNull().default(false),
    confidence: real('confidence').notNull(),
    status: text('status').notNull(),
    block_number: bigint('block_number', { mode: 'bigint' }),
    block_hash: text('block_hash'),
    transaction_hash: text('transaction_hash'),
    ...timestamps,
  },
  (table) => [
    index('price_observations_asset_time_idx').on(
      table.chain_id,
      table.asset_key,
      table.observed_at,
    ),
    index('price_observations_source_time_idx').on(table.source, table.observed_at),
  ],
);

// ─── Derived analytics ──────────────────────────────────────────────────────

export const tokenMetrics1m = pgTable(
  'token_metrics_1m',
  {
    chain_id: integer('chain_id').notNull(),
    token_address: text('token_address').notNull(),
    bucket_start: timestamp('bucket_start', { withTimezone: true }).notNull(),
    open_price: numeric('open_price', { precision: 78, scale: 0 }).notNull(),
    high_price: numeric('high_price', { precision: 78, scale: 0 }).notNull(),
    low_price: numeric('low_price', { precision: 78, scale: 0 }).notNull(),
    close_price: numeric('close_price', { precision: 78, scale: 0 }).notNull(),
    volume: numeric('volume', { precision: 78, scale: 0 }).notNull(),
    buys: integer('buys').notNull().default(0),
    sells: integer('sells').notNull().default(0),
    unique_traders: integer('unique_traders').notNull().default(0),
    liquidity: numeric('liquidity', { precision: 78, scale: 0 }).notNull(),
    market_cap: numeric('market_cap', { precision: 38, scale: 18 }),
    fdv: numeric('fdv', { precision: 38, scale: 18 }),
    holder_count: integer('holder_count').notNull().default(0),
    holder_growth: integer('holder_growth').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.chain_id, table.token_address, table.bucket_start] }),
    index('token_metrics_1m_bucket_idx').on(table.bucket_start),
  ],
);

export const tokenMetrics1h = pgTable(
  'token_metrics_1h',
  {
    chain_id: integer('chain_id').notNull(),
    token_address: text('token_address').notNull(),
    bucket_start: timestamp('bucket_start', { withTimezone: true }).notNull(),
    open_price: numeric('open_price', { precision: 78, scale: 0 }).notNull(),
    high_price: numeric('high_price', { precision: 78, scale: 0 }).notNull(),
    low_price: numeric('low_price', { precision: 78, scale: 0 }).notNull(),
    close_price: numeric('close_price', { precision: 78, scale: 0 }).notNull(),
    volume: numeric('volume', { precision: 78, scale: 0 }).notNull(),
    buys: integer('buys').notNull().default(0),
    sells: integer('sells').notNull().default(0),
    unique_traders: integer('unique_traders').notNull().default(0),
    liquidity: numeric('liquidity', { precision: 78, scale: 0 }).notNull(),
    market_cap: numeric('market_cap', { precision: 38, scale: 18 }),
    fdv: numeric('fdv', { precision: 38, scale: 18 }),
    holder_count: integer('holder_count').notNull().default(0),
    holder_growth: integer('holder_growth').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.chain_id, table.token_address, table.bucket_start] }),
    index('token_metrics_1h_bucket_idx').on(table.bucket_start),
  ],
);

export const tokenMetrics1d = pgTable(
  'token_metrics_1d',
  {
    chain_id: integer('chain_id').notNull(),
    token_address: text('token_address').notNull(),
    bucket_start: timestamp('bucket_start', { withTimezone: true }).notNull(),
    open_price: numeric('open_price', { precision: 78, scale: 0 }).notNull(),
    high_price: numeric('high_price', { precision: 78, scale: 0 }).notNull(),
    low_price: numeric('low_price', { precision: 78, scale: 0 }).notNull(),
    close_price: numeric('close_price', { precision: 78, scale: 0 }).notNull(),
    volume: numeric('volume', { precision: 78, scale: 0 }).notNull(),
    buys: integer('buys').notNull().default(0),
    sells: integer('sells').notNull().default(0),
    unique_traders: integer('unique_traders').notNull().default(0),
    liquidity: numeric('liquidity', { precision: 78, scale: 0 }).notNull(),
    market_cap: numeric('market_cap', { precision: 38, scale: 18 }),
    fdv: numeric('fdv', { precision: 38, scale: 18 }),
    holder_count: integer('holder_count').notNull().default(0),
    holder_growth: integer('holder_growth').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.chain_id, table.token_address, table.bucket_start] }),
    index('token_metrics_1d_bucket_idx').on(table.bucket_start),
  ],
);

// ─── Infrastructure ──────────────────────────────────────────────────────────

export const marketDataSources = pgTable(
  'market_data_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    source_type: marketDataSourceType('source_type').notNull(),
    api_endpoint: text('api_endpoint').notNull(),
    api_key_env_var: text('api_key_env_var').notNull(),
    rate_limit_per_minute: integer('rate_limit_per_minute').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    last_sync_at: timestamp('last_sync_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex('market_data_sources_name_idx').on(table.name)],
);
