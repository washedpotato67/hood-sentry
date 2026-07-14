import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

const numeric78 = customType<{ data: string }>({
  dataType: () => 'numeric(78,0)',
});

const now = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).defaultNow().notNull();

export const chains = pgTable('chains', {
  chainId: bigint('chain_id', { mode: 'bigint' }).primaryKey(),
  name: varchar('name', { length: 128 }).notNull(),
  nativeSymbol: varchar('native_symbol', { length: 16 }).notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  headBlockNumber: bigint('head_block_number', { mode: 'bigint' }),
  finalizedBlockNumber: bigint('finalized_block_number', { mode: 'bigint' }),
  createdAt: now(),
  updatedAt: updatedAt(),
});

export const blocks = pgTable(
  'blocks',
  {
    chainId: bigint('chain_id', { mode: 'bigint' }).notNull(),
    number: bigint('number', { mode: 'bigint' }).notNull(),
    hash: varchar('hash', { length: 66 }).notNull(),
    parentHash: varchar('parent_hash', { length: 66 }).notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    finalityState: varchar('finality_state', { length: 32 }).notNull(),
    canonical: boolean('canonical').default(true).notNull(),
    createdAt: now(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.number, t.hash] }),
    index('blocks_chain_number_idx').on(t.chainId, t.number),
    index('blocks_chain_canonical_number_idx').on(t.chainId, t.canonical, t.number),
    index('blocks_canonical_idx').on(t.chainId, t.canonical).where(sql`${t.canonical} = true`),
  ],
);

export const transactions = pgTable(
  'transactions',
  {
    chainId: bigint('chain_id', { mode: 'bigint' }).notNull(),
    hash: varchar('hash', { length: 66 }).notNull(),
    blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
    blockHash: varchar('block_hash', { length: 66 }).notNull(),
    fromAddress: varchar('from_address', { length: 42 }).notNull(),
    toAddress: varchar('to_address', { length: 42 }),
    nonce: bigint('nonce', { mode: 'bigint' }).notNull(),
    valueRaw: numeric78('value_raw').notNull(),
    input: text('input'),
    status: integer('status').notNull(),
    gasUsed: bigint('gas_used', { mode: 'bigint' }).notNull(),
    effectiveGasPrice: bigint('effective_gas_price', { mode: 'bigint' }).notNull(),
    contractCreated: varchar('contract_created', { length: 42 }),
    canonical: boolean('canonical').default(true).notNull(),
    createdAt: now(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.hash] }),
    index('transactions_chain_block_idx').on(t.chainId, t.blockNumber),
    index('transactions_chain_from_idx').on(t.chainId, t.fromAddress),
    index('transactions_chain_to_idx').on(t.chainId, t.toAddress),
    index('transactions_created_at_idx').on(t.createdAt),
  ],
);

export const transactionReceipts = pgTable(
  'transaction_receipts',
  {
    chainId: bigint('chain_id', { mode: 'bigint' }).notNull(),
    transactionHash: varchar('transaction_hash', { length: 66 }).notNull(),
    blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
    blockHash: varchar('block_hash', { length: 66 }).notNull(),
    status: integer('status').notNull(),
    gasUsed: bigint('gas_used', { mode: 'bigint' }).notNull(),
    cumulativeGasUsed: bigint('cumulative_gas_used', { mode: 'bigint' }).notNull(),
    logsCount: integer('logs_count').notNull(),
    createdAt: now(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.transactionHash] })],
);

export const logs = pgTable(
  'logs',
  {
    chainId: bigint('chain_id', { mode: 'bigint' }).notNull(),
    transactionHash: varchar('transaction_hash', { length: 66 }).notNull(),
    logIndex: integer('log_index').notNull(),
    blockHash: varchar('block_hash', { length: 66 }).notNull(),
    blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
    address: varchar('address', { length: 42 }).notNull(),
    topic0: varchar('topic0', { length: 66 }),
    topic1: varchar('topic1', { length: 66 }),
    topic2: varchar('topic2', { length: 66 }),
    topic3: varchar('topic3', { length: 66 }),
    data: text('data').notNull(),
    removed: boolean('removed').default(false).notNull(),
    canonical: boolean('canonical').default(true).notNull(),
    createdAt: now(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.transactionHash, t.logIndex, t.blockHash] }),
    index('logs_chain_address_idx').on(t.chainId, t.address),
    index('logs_chain_block_idx').on(t.chainId, t.blockNumber),
    index('logs_chain_topic0_idx').on(t.chainId, t.topic0),
    index('logs_canonical_idx').on(t.chainId, t.canonical).where(sql`${t.canonical} = true`),
    index('logs_created_at_idx').on(t.createdAt),
  ],
);

export const indexerCheckpoints = pgTable(
  'indexer_checkpoints',
  {
    chainId: bigint('chain_id', { mode: 'bigint' }).notNull(),
    stream: varchar('stream', { length: 128 }).notNull(),
    nextBlock: bigint('next_block', { mode: 'bigint' }).notNull(),
    lastBlockHash: varchar('last_block_hash', { length: 66 }),
    lockedBy: varchar('locked_by', { length: 128 }),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.stream] })],
);

export const indexerLeases = pgTable(
  'indexer_leases',
  {
    chainId: bigint('chain_id', { mode: 'bigint' }).notNull(),
    stream: varchar('stream', { length: 128 }).notNull(),
    workerId: varchar('worker_id', { length: 128 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: now(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.stream, t.workerId] })],
);

export const reorgEvents = pgTable(
  'reorg_events',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    chainId: bigint('chain_id', { mode: 'bigint' }).notNull(),
    fromBlock: bigint('from_block', { mode: 'bigint' }).notNull(),
    toBlock: bigint('to_block', { mode: 'bigint' }).notNull(),
    commonAncestorBlock: bigint('common_ancestor_block', { mode: 'bigint' }).notNull(),
    blocksOrphaned: integer('blocks_orphaned').notNull(),
    detectedAt: timestamp('detected_at', { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    index('reorg_events_chain_idx').on(t.chainId),
    index('reorg_events_detected_idx').on(t.detectedAt),
  ],
);
