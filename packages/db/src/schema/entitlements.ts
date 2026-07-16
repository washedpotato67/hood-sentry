import {
  bigint,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const tokenEntitlementStates = pgTable(
  'token_entitlement_states',
  {
    chainId: integer('chain_id').notNull(),
    tokenAddress: text('token_address').notNull(),
    walletAddress: text('wallet_address').notNull(),
    eligibleTier: text('eligible_tier').notNull(),
    grantedTier: text('granted_tier').notNull(),
    candidateTier: text('candidate_tier'),
    candidateSince: timestamp('candidate_since', { withTimezone: true }),
    candidateStartBlock: bigint('candidate_start_block', { mode: 'bigint' }),
    balanceRaw: numeric('balance_raw', { precision: 78, scale: 0 }).notNull(),
    indexedBalanceRaw: numeric('indexed_balance_raw', { precision: 78, scale: 0 }).notNull(),
    observedBlock: bigint('observed_block', { mode: 'bigint' }).notNull(),
    observedBlockHash: text('observed_block_hash').notNull(),
    status: text('status').notNull(),
    reasons: jsonb('reasons').notNull().default([]),
    methodologyVersion: text('methodology_version').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.chainId, table.tokenAddress, table.walletAddress] }),
    index('token_entitlement_states_wallet_idx').on(
      table.chainId,
      table.walletAddress,
      table.expiresAt,
    ),
  ],
);
