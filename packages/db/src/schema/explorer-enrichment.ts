import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

const timestamps = {
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const explorerVerificationStatusEnum = pgEnum('explorer_verification_status', [
  'fully_verified',
  'partially_verified',
  'verified',
  'unverified',
]);

export const dataQualityWarningStatusEnum = pgEnum('data_quality_warning_status', [
  'open',
  'resolved',
]);

export const explorerContractMetadata = pgTable(
  'explorer_contract_metadata',
  {
    chain_id: integer('chain_id').notNull(),
    address: varchar('address', { length: 42 }).notNull(),
    provider: varchar('provider', { length: 64 }).notNull(),
    provider_url: text('provider_url').notNull(),
    provider_endpoints: jsonb('provider_endpoints').notNull(),
    cache_key: varchar('cache_key', { length: 256 }).notNull(),
    cache_entry: jsonb('cache_entry').notNull(),
    verification_status: explorerVerificationStatusEnum('verification_status').notNull(),
    source_files: jsonb('source_files').notNull(),
    source_hash: varchar('source_hash', { length: 66 }),
    abi: jsonb('abi'),
    compiler_version: varchar('compiler_version', { length: 128 }),
    optimizer_enabled: boolean('optimizer_enabled'),
    optimizer_runs: integer('optimizer_runs'),
    compiler_settings: jsonb('compiler_settings'),
    constructor_arguments: text('constructor_arguments'),
    contract_name: varchar('contract_name', { length: 256 }),
    proxy_metadata: jsonb('proxy_metadata').notNull(),
    token_labels: jsonb('token_labels').notNull(),
    raw_response: jsonb('raw_response').notNull(),
    warnings: jsonb('warnings').notNull(),
    fetched_at: timestamp('fetched_at', { withTimezone: true }).notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.chain_id, table.address, table.provider] }),
    uniqueIndex('explorer_contract_metadata_cache_key_uidx').on(table.cache_key),
    index('explorer_contract_metadata_expiry_idx').on(table.expires_at),
  ],
);

export const dataQualityWarnings = pgTable(
  'data_quality_warnings',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    fingerprint: varchar('fingerprint', { length: 66 }).notNull(),
    chain_id: integer('chain_id').notNull(),
    address: varchar('address', { length: 42 }).notNull(),
    category: varchar('category', { length: 64 }).notNull(),
    field: varchar('field', { length: 64 }).notNull(),
    chain_value: jsonb('chain_value'),
    provider_value: jsonb('provider_value'),
    provider: varchar('provider', { length: 64 }).notNull(),
    provider_fetched_at: timestamp('provider_fetched_at', { withTimezone: true }).notNull(),
    status: dataQualityWarningStatusEnum('status').notNull().default('open'),
    resolved_at: timestamp('resolved_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('data_quality_warnings_fingerprint_uidx').on(table.fingerprint),
    index('data_quality_warnings_contract_idx').on(table.chain_id, table.address, table.status),
  ],
);
