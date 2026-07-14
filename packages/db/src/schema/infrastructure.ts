import { jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

export const idempotencyKeys = pgTable('idempotency_keys', {
  id: varchar('id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  key: varchar('key', { length: 255 }).notNull(),
  namespace: varchar('namespace', { length: 100 }).notNull(),
  response_status: varchar('response_status', { length: 50 }).notNull(),
  response_data: jsonb('response_data'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  expires_at: timestamp('expires_at', { withTimezone: true }),
});

export const leases = pgTable('leases', {
  key: varchar('key', { length: 255 }).primaryKey(),
  owner_id: varchar('owner_id', { length: 255 }).notNull(),
  metadata: jsonb('metadata'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
});
