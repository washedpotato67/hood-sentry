import {
  bigint,
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const discoverySnapshots = pgTable(
  'discovery_snapshots',
  {
    chain_id: integer('chain_id').notNull(),
    token_address: text('token_address').notNull(),
    methodology_version: text('methodology_version').notNull(),
    source_block_number: bigint('source_block_number', { mode: 'bigint' }).notNull(),
    source_block_hash: text('source_block_hash').notNull(),
    score_bps: numeric('score_bps', { precision: 78, scale: 0 }).notNull(),
    confidence_bps: numeric('confidence_bps', { precision: 78, scale: 0 }).notNull(),
    payload: text('payload').notNull(),
    canonical: boolean('canonical').notNull().default(true),
    observed_at: timestamp('observed_at', { withTimezone: true }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.chain_id,
        table.token_address,
        table.methodology_version,
        table.source_block_number,
      ],
    }),
    index('discovery_snapshots_rank_idx').on(
      table.chain_id,
      table.methodology_version,
      table.canonical,
      table.score_bps,
    ),
    index('discovery_snapshots_block_idx').on(table.chain_id, table.source_block_number),
  ],
);

export const discoveryCurrent = pgTable(
  'discovery_current',
  {
    chain_id: integer('chain_id').notNull(),
    token_address: text('token_address').notNull(),
    methodology_version: text('methodology_version').notNull(),
    source_block_number: bigint('source_block_number', { mode: 'bigint' }).notNull(),
    source_block_hash: text('source_block_hash').notNull(),
    score_bps: numeric('score_bps', { precision: 78, scale: 0 }).notNull(),
    confidence_bps: numeric('confidence_bps', { precision: 78, scale: 0 }).notNull(),
    payload: text('payload').notNull(),
    canonical: boolean('canonical').notNull().default(true),
    observed_at: timestamp('observed_at', { withTimezone: true }).notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.chain_id, table.token_address, table.methodology_version] }),
    index('discovery_current_rank_idx').on(
      table.chain_id,
      table.methodology_version,
      table.canonical,
      table.score_bps,
    ),
  ],
);

export const sponsoredPlacements = pgTable(
  'sponsored_placements',
  {
    placement_id: uuid('placement_id').primaryKey().defaultRandom(),
    chain_id: integer('chain_id').notNull(),
    token_address: text('token_address').notNull(),
    feed: text('feed').notNull(),
    priority: integer('priority').notNull(),
    starts_at: timestamp('starts_at', { withTimezone: true }).notNull(),
    ends_at: timestamp('ends_at', { withTimezone: true }).notNull(),
    label: text('label').notNull().default('Sponsored'),
    disclosure: text('disclosure').notNull(),
    created_by: text('created_by').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('sponsored_placements_active_idx').on(
      table.chain_id,
      table.feed,
      table.starts_at,
      table.ends_at,
    ),
  ],
);

export const sponsoredPlacementAudit = pgTable(
  'sponsored_placement_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    placement_id: uuid('placement_id').notNull(),
    action: text('action').notNull(),
    actor_id: text('actor_id').notNull(),
    before_payload: text('before_payload'),
    after_payload: text('after_payload'),
    reason: text('reason').notNull(),
    recorded_at: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('sponsored_placement_audit_placement_idx').on(table.placement_id, table.recorded_at),
  ],
);
