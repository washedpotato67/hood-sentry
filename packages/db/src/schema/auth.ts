import {
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
  uuid,
} from 'drizzle-orm/pg-core';

// ─── Enums ───────────────────────────────────────────────────────────────────

export const userStatusEnum = pgEnum('user_status', ['active', 'suspended', 'deleted']);

export const securityEventTypeEnum = pgEnum('security_event_type', [
  'login_success',
  'login_failure',
  'session_revoked',
  'api_key_created',
  'api_key_revoked',
  'wallet_linked',
  'wallet_unlinked',
  'suspicious_activity',
  'rate_limit_exceeded',
  'privilege_escalation_attempt',
]);

export const securitySeverityEnum = pgEnum('security_severity', ['info', 'warning', 'critical']);

// ─── Users ───────────────────────────────────────────────────────────────────

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    status: userStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('users_status_idx').on(table.status),
    index('users_created_at_idx').on(table.createdAt),
  ],
);

// ─── User Wallets ────────────────────────────────────────────────────────────

export const userWallets = pgTable(
  'user_wallets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    chainId: integer('chain_id').notNull(),
    address: text('address').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('user_wallets_user_id_idx').on(table.userId),
    uniqueIndex('user_wallets_chain_address_idx').on(table.chainId, table.address),
    index('user_wallets_user_primary_idx').on(table.userId, table.isPrimary),
  ],
);

// ─── SIWE Nonces ─────────────────────────────────────────────────────────────

export const siweNonces = pgTable(
  'siwe_nonces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hashedNonce: text('hashed_nonce').notNull(),
    domain: text('domain').notNull(),
    uri: text('uri').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('siwe_nonces_hashed_nonce_idx').on(table.hashedNonce),
    index('siwe_nonces_expires_at_idx').on(table.expiresAt),
  ],
);

// ─── Sessions ────────────────────────────────────────────────────────────────

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    hashedSessionToken: text('hashed_session_token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    deviceMetadata: jsonb('device_metadata'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('sessions_hashed_session_token_idx').on(table.hashedSessionToken),
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);

// ─── API Keys ────────────────────────────────────────────────────────────────

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    keyPrefix: text('key_prefix').notNull(),
    hashedSecret: text('hashed_secret').notNull(),
    name: text('name').notNull(),
    scopes: jsonb('scopes'),
    quotaPerMinute: integer('quota_per_minute'),
    quotaPerDay: integer('quota_per_day'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('api_keys_user_id_idx').on(table.userId),
    uniqueIndex('api_keys_hashed_secret_idx').on(table.hashedSecret),
    index('api_keys_key_prefix_idx').on(table.keyPrefix),
  ],
);

export const apiKeyUsageBuckets = pgTable(
  'api_key_usage_buckets',
  {
    apiKeyId: uuid('api_key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
    periodKind: text('period_kind').notNull(),
    bucketStart: timestamp('bucket_start', { withTimezone: true }).notNull(),
    requestCount: integer('request_count').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.apiKeyId, table.periodKind, table.bucketStart] }),
    index('api_key_usage_buckets_expiry_idx').on(table.periodKind, table.bucketStart),
  ],
);

// ─── User Security Events ────────────────────────────────────────────────────

export const userSecurityEvents = pgTable(
  'user_security_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventType: securityEventTypeEnum('event_type').notNull(),
    severity: securitySeverityEnum('severity').notNull().default('info'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata'),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('user_security_events_user_id_idx').on(table.userId),
    index('user_security_events_event_type_idx').on(table.eventType),
    index('user_security_events_severity_idx').on(table.severity),
    index('user_security_events_detected_at_idx').on(table.detectedAt),
  ],
);
