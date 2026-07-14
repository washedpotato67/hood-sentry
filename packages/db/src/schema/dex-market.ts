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

export const liquidityEventType = pgEnum('liquidity_event_type', [
  'liquidityAdded',
  'liquidityRemoved',
  'lpMinted',
  'lpBurned',
  'positionCreated',
  'positionIncreased',
  'positionDecreased',
  'feesCollected',
  'bondingCurveLiquidity',
  'migrationLiquidity',
]);

export const protocolKind = pgEnum('protocol_kind', ['dex', 'launchpad']);
export const protocolValidationStatus = pgEnum('protocol_validation_status', [
  'active',
  'disabled',
  'failed',
]);
export const launchpadTradeSide = pgEnum('launchpad_trade_side', ['buy', 'sell']);

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
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    chain_id: integer('chain_id').notNull(),
    protocol_key: text('protocol_key').notNull(),
    protocol_name: text('protocol_name').notNull(),
    version: text('version').notNull(),
    kind: protocolKind('kind').notNull().default('dex'),
    factory_address: text('factory_address'),
    router_address: text('router_address'),
    quoter_address: text('quoter_address'),
    verification_source: text('verification_source').notNull(),
    verification_date: timestamp('verification_date', { withTimezone: true }).notNull(),
    registry_version: text('registry_version').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    validation_status: protocolValidationStatus('validation_status').notNull().default('disabled'),
    validated_at: timestamp('validated_at', { withTimezone: true }),
    validation_expires_at: timestamp('validation_expires_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('dex_protocols_chain_name_version_idx').on(
      table.chain_id,
      table.protocol_key,
      table.version,
    ),
  ],
);

export const protocolContracts = pgTable(
  'protocol_contracts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    protocol_id: bigint('protocol_id', { mode: 'bigint' })
      .notNull()
      .references(() => dexProtocols.id),
    chain_id: integer('chain_id').notNull(),
    protocol_key: text('protocol_key').notNull(),
    protocol_version: text('protocol_version').notNull(),
    contract_role: text('contract_role').notNull(),
    address: text('address').notNull(),
    official_source_url: text('official_source_url').notNull(),
    explorer_url: text('explorer_url').notNull(),
    verified_at: timestamp('verified_at', { withTimezone: true }).notNull(),
    expected_runtime_bytecode_hash: text('expected_runtime_bytecode_hash').notNull(),
    proxy_type: text('proxy_type'),
    implementation_address: text('implementation_address'),
    admin_address: text('admin_address'),
    enabled: boolean('enabled').notNull().default(false),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('protocol_contracts_role_idx').on(
      table.chain_id,
      table.protocol_key,
      table.protocol_version,
      table.contract_role,
    ),
    uniqueIndex('protocol_contracts_address_idx').on(
      table.chain_id,
      table.protocol_key,
      table.protocol_version,
      table.address,
    ),
  ],
);

export const protocolContractVerifications = pgTable(
  'protocol_contract_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    protocol_contract_id: uuid('protocol_contract_id')
      .notNull()
      .references(() => protocolContracts.id),
    chain_id: integer('chain_id').notNull(),
    observed_runtime_bytecode_hash: text('observed_runtime_bytecode_hash'),
    observed_implementation_address: text('observed_implementation_address'),
    observed_admin_address: text('observed_admin_address'),
    valid: boolean('valid').notNull(),
    failure_code: text('failure_code'),
    errors: jsonb('errors').$type<readonly string[]>().notNull().default([]),
    checked_at: timestamp('checked_at', { withTimezone: true }).notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index('protocol_contract_verifications_contract_idx').on(
      table.protocol_contract_id,
      table.checked_at,
    ),
  ],
);

export const pools = pgTable(
  'pools',
  {
    chain_id: integer('chain_id').notNull(),
    address: text('address').notNull(),
    protocol_id: bigint('protocol_id', { mode: 'bigint' })
      .notNull()
      .references(() => dexProtocols.id),
    protocol_key: text('protocol_key').notNull(),
    protocol_version: text('protocol_version').notNull(),
    factory_address: text('factory_address').notNull(),
    token0_address: text('token0_address').notNull(),
    token1_address: text('token1_address').notNull(),
    fee_tier: numeric('fee_tier', { precision: 78, scale: 0 }),
    tick_spacing: integer('tick_spacing'),
    pool_type: text('pool_type').notNull(),
    created_block: bigint('created_block', { mode: 'bigint' }).notNull(),
    created_block_hash: text('created_block_hash').notNull(),
    created_tx_hash: text('created_tx_hash').notNull(),
    creation_log_index: integer('creation_log_index').notNull(),
    canonical: boolean('canonical').notNull().default(true),
    active: boolean('active').notNull().default(true),
    state: jsonb('state').$type<Record<string, string | number>>(),
    state_block_number: bigint('state_block_number', { mode: 'bigint' }),
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
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    chain_id: integer('chain_id').notNull(),
    protocol_key: text('protocol_key').notNull(),
    protocol_version: text('protocol_version').notNull(),
    block_number: bigint('block_number', { mode: 'bigint' }).notNull(),
    block_hash: text('block_hash').notNull(),
    transaction_hash: text('transaction_hash').notNull(),
    log_index: integer('log_index').notNull(),
    pool_address: text('pool_address').notNull(),
    sender_address: text('sender_address'),
    recipient_address: text('recipient_address'),
    token_in_address: text('token_in_address').notNull(),
    token_out_address: text('token_out_address').notNull(),
    amount_in_raw: numeric('amount_in_raw', { precision: 78, scale: 0 }).notNull(),
    amount_out_raw: numeric('amount_out_raw', { precision: 78, scale: 0 }).notNull(),
    fee_raw: numeric('fee_raw', { precision: 78, scale: 0 }),
    canonical: boolean('canonical').notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('swaps_chain_block_tx_log_idx').on(
      table.chain_id,
      table.block_hash,
      table.transaction_hash,
      table.log_index,
    ),
    index('swaps_pool_block_idx').on(table.chain_id, table.pool_address, table.block_number),
    index('swaps_sender_idx').on(table.chain_id, table.sender_address),
    index('swaps_block_number_idx').on(table.chain_id, table.block_number),
  ],
);

export const liquidityEvents = pgTable(
  'liquidity_events',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    chain_id: integer('chain_id').notNull(),
    protocol_key: text('protocol_key').notNull(),
    protocol_version: text('protocol_version').notNull(),
    block_number: bigint('block_number', { mode: 'bigint' }).notNull(),
    block_hash: text('block_hash').notNull(),
    transaction_hash: text('transaction_hash').notNull(),
    log_index: integer('log_index').notNull(),
    pool_address: text('pool_address').notNull(),
    event_type: liquidityEventType('event_type').notNull(),
    provider_address: text('provider_address'),
    owner_address: text('owner_address'),
    recipient_address: text('recipient_address'),
    token0_address: text('token0_address').notNull(),
    token1_address: text('token1_address').notNull(),
    token0_amount_raw: numeric('token0_amount_raw', { precision: 78, scale: 0 }).notNull(),
    token1_amount_raw: numeric('token1_amount_raw', { precision: 78, scale: 0 }).notNull(),
    position_id: numeric('position_id', { precision: 78, scale: 0 }),
    tick_lower: integer('tick_lower'),
    tick_upper: integer('tick_upper'),
    canonical: boolean('canonical').notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('liquidity_events_chain_block_tx_log_idx').on(
      table.chain_id,
      table.block_hash,
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

export const protocolQuotes = pgTable(
  'protocol_quotes',
  {
    quote_id: text('quote_id').primaryKey(),
    chain_id: integer('chain_id').notNull(),
    protocol_key: text('protocol_key').notNull(),
    protocol_version: text('protocol_version').notNull(),
    input_token_address: text('input_token_address').notNull(),
    output_token_address: text('output_token_address').notNull(),
    amount_in_raw: numeric('amount_in_raw', { precision: 78, scale: 0 }).notNull(),
    expected_amount_out_raw: numeric('expected_amount_out_raw', {
      precision: 78,
      scale: 0,
    }).notNull(),
    minimum_amount_out_raw: numeric('minimum_amount_out_raw', {
      precision: 78,
      scale: 0,
    }).notNull(),
    source_block_number: bigint('source_block_number', { mode: 'bigint' }).notNull(),
    route: jsonb('route').notNull(),
    warnings: jsonb('warnings').notNull(),
    transaction_target: text('transaction_target').notNull(),
    transaction_selector: text('transaction_selector').notNull(),
    spender_address: text('spender_address'),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index('protocol_quotes_expiry_idx').on(table.expires_at)],
);

export const launchpadTokens = pgTable(
  'launchpad_tokens',
  {
    chain_id: integer('chain_id').notNull(),
    protocol_key: text('protocol_key').notNull(),
    protocol_version: text('protocol_version').notNull(),
    token_address: text('token_address').notNull(),
    creator_address: text('creator_address').notNull(),
    token_implementation_address: text('token_implementation_address'),
    initial_supply_raw: numeric('initial_supply_raw', { precision: 78, scale: 0 }).notNull(),
    bonding_curve_address: text('bonding_curve_address'),
    block_number: bigint('block_number', { mode: 'bigint' }).notNull(),
    block_hash: text('block_hash').notNull(),
    transaction_hash: text('transaction_hash').notNull(),
    log_index: integer('log_index').notNull(),
    canonical: boolean('canonical').notNull().default(true),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.chain_id, table.token_address, table.block_hash] }),
    uniqueIndex('launchpad_tokens_event_idx').on(
      table.chain_id,
      table.block_hash,
      table.transaction_hash,
      table.log_index,
    ),
  ],
);

export const launchpadTrades = pgTable(
  'launchpad_trades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chain_id: integer('chain_id').notNull(),
    protocol_key: text('protocol_key').notNull(),
    protocol_version: text('protocol_version').notNull(),
    token_address: text('token_address').notNull(),
    bonding_curve_address: text('bonding_curve_address').notNull(),
    trader_address: text('trader_address').notNull(),
    side: launchpadTradeSide('side').notNull(),
    token_amount_raw: numeric('token_amount_raw', { precision: 78, scale: 0 }).notNull(),
    payment_amount_raw: numeric('payment_amount_raw', { precision: 78, scale: 0 }).notNull(),
    creator_fee_raw: numeric('creator_fee_raw', { precision: 78, scale: 0 }),
    protocol_fee_raw: numeric('protocol_fee_raw', { precision: 78, scale: 0 }),
    block_number: bigint('block_number', { mode: 'bigint' }).notNull(),
    block_hash: text('block_hash').notNull(),
    transaction_hash: text('transaction_hash').notNull(),
    log_index: integer('log_index').notNull(),
    canonical: boolean('canonical').notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('launchpad_trades_event_idx').on(
      table.chain_id,
      table.block_hash,
      table.transaction_hash,
      table.log_index,
    ),
  ],
);

export const launchpadCreatorFeeEvents = pgTable(
  'launchpad_creator_fee_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chain_id: integer('chain_id').notNull(),
    protocol_key: text('protocol_key').notNull(),
    protocol_version: text('protocol_version').notNull(),
    token_address: text('token_address').notNull(),
    bonding_curve_address: text('bonding_curve_address').notNull(),
    trader_address: text('trader_address').notNull(),
    amount_raw: numeric('amount_raw', { precision: 78, scale: 0 }).notNull(),
    block_number: bigint('block_number', { mode: 'bigint' }).notNull(),
    block_hash: text('block_hash').notNull(),
    transaction_hash: text('transaction_hash').notNull(),
    log_index: integer('log_index').notNull(),
    canonical: boolean('canonical').notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('launchpad_creator_fee_events_event_idx').on(
      table.chain_id,
      table.block_hash,
      table.transaction_hash,
      table.log_index,
    ),
  ],
);

export const launchpadGraduations = pgTable(
  'launchpad_graduations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chain_id: integer('chain_id').notNull(),
    protocol_key: text('protocol_key').notNull(),
    protocol_version: text('protocol_version').notNull(),
    token_address: text('token_address').notNull(),
    bonding_curve_address: text('bonding_curve_address').notNull(),
    graduation_threshold_raw: numeric('graduation_threshold_raw', { precision: 78, scale: 0 }),
    block_number: bigint('block_number', { mode: 'bigint' }).notNull(),
    block_hash: text('block_hash').notNull(),
    transaction_hash: text('transaction_hash').notNull(),
    log_index: integer('log_index').notNull(),
    canonical: boolean('canonical').notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('launchpad_graduations_event_idx').on(
      table.chain_id,
      table.block_hash,
      table.transaction_hash,
      table.log_index,
    ),
  ],
);

export const launchpadMigrations = pgTable(
  'launchpad_migrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chain_id: integer('chain_id').notNull(),
    protocol_key: text('protocol_key').notNull(),
    protocol_version: text('protocol_version').notNull(),
    token_address: text('token_address').notNull(),
    migration_address: text('migration_address').notNull(),
    destination_protocol_key: text('destination_protocol_key').notNull(),
    destination_pool_address: text('destination_pool_address').notNull(),
    token_liquidity_raw: numeric('token_liquidity_raw', { precision: 78, scale: 0 }),
    paired_liquidity_raw: numeric('paired_liquidity_raw', { precision: 78, scale: 0 }),
    block_number: bigint('block_number', { mode: 'bigint' }).notNull(),
    block_hash: text('block_hash').notNull(),
    transaction_hash: text('transaction_hash').notNull(),
    log_index: integer('log_index').notNull(),
    canonical: boolean('canonical').notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('launchpad_migrations_event_idx').on(
      table.chain_id,
      table.block_hash,
      table.transaction_hash,
      table.log_index,
    ),
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
