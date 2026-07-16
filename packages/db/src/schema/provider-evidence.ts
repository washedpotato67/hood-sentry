import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const providerEvidence = pgTable(
  'provider_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: text('provider_id').notNull(),
    capability: text('capability').notNull(),
    trustClass: text('trust_class').notNull(),
    chainId: integer('chain_id'),
    requestFingerprint: text('request_fingerprint').notNull(),
    responseHash: text('response_hash').notNull(),
    responsePayload: jsonb('response_payload').notNull(),
    responseBytes: integer('response_bytes').notNull(),
    httpStatus: integer('http_status').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    sourceBlockNumber: bigint('source_block_number', { mode: 'bigint' }),
    sourceBlockHash: text('source_block_hash'),
    canonical: boolean('canonical').notNull().default(true),
    registryVersion: text('registry_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    identityIdx: uniqueIndex('provider_evidence_identity_idx').on(
      table.providerId,
      table.capability,
      table.requestFingerprint,
      table.responseHash,
    ),
    providerTimeIdx: index('provider_evidence_provider_time_idx').on(
      table.providerId,
      table.capability,
      table.fetchedAt,
    ),
    chainBlockIdx: index('provider_evidence_chain_block_idx').on(
      table.chainId,
      table.sourceBlockNumber,
    ),
  }),
);
