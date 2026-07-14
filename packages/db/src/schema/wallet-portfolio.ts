import {
  bigint,
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

export const labelTypeEnum = pgEnum('label_type', [
  'ens',
  'exchange',
  'defi_protocol',
  'whale',
  'bot',
  'bridge',
  'multisig',
  'dao',
  'custom',
]);

export const flowTypeEnum = pgEnum('flow_type', ['inflow', 'outflow']);

export const classificationTypeEnum = pgEnum('classification_type', [
  'dex_router',
  'lending_pool',
  'bridge',
  'staking',
  'nft_marketplace',
  'aggregator',
  'multisig',
  'unknown',
]);

export const wallets = pgTable(
  'wallets',
  {
    chainId: integer('chain_id').notNull(),
    address: varchar('address', { length: 42 }).notNull(),
    firstSeenBlock: bigint('first_seen_block', { mode: 'bigint' }).notNull(),
    userOwned: boolean('user_owned').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.chainId, table.address] }),
    index('wallets_first_seen_block_idx').on(table.firstSeenBlock),
  ],
);

export const walletLabels = pgTable(
  'wallet_labels',
  {
    id: text('id').primaryKey(),
    chainId: integer('chain_id').notNull(),
    address: varchar('address', { length: 42 }).notNull(),
    labelType: labelTypeEnum('label_type').notNull(),
    labelValue: text('label_value').notNull(),
    source: text('source').notNull(),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('wallet_labels_chain_address_type_idx').on(
      table.chainId,
      table.address,
      table.labelType,
    ),
    index('wallet_labels_chain_address_idx').on(table.chainId, table.address),
    index('wallet_labels_source_idx').on(table.source),
  ],
);

export const walletTokenLots = pgTable(
  'wallet_token_lots',
  {
    id: text('id').primaryKey(),
    chainId: integer('chain_id').notNull(),
    walletAddress: varchar('wallet_address', { length: 42 }).notNull(),
    tokenAddress: varchar('token_address', { length: 42 }).notNull(),
    acquisitionTxHash: varchar('acquisition_tx_hash', { length: 66 }).notNull(),
    amountRaw: numeric('amount_raw', { precision: 78, scale: 0 }).notNull(),
    unitCostRaw: numeric('unit_cost_raw', { precision: 78, scale: 0 }).notNull(),
    unitCostDecimals: integer('unit_cost_decimals').notNull(),
    remainingAmountRaw: numeric('remaining_amount_raw', { precision: 78, scale: 0 }).notNull(),
    methodology: text('methodology').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('wallet_token_lots_chain_wallet_token_idx').on(
      table.chainId,
      table.walletAddress,
      table.tokenAddress,
    ),
    index('wallet_token_lots_tx_hash_idx').on(table.acquisitionTxHash),
    index('wallet_token_lots_remaining_idx').on(table.chainId, table.remainingAmountRaw),
  ],
);

export const walletPnlSnapshots = pgTable(
  'wallet_pnl_snapshots',
  {
    id: text('id').primaryKey(),
    chainId: integer('chain_id').notNull(),
    walletAddress: varchar('wallet_address', { length: 42 }).notNull(),
    tokenAddress: varchar('token_address', { length: 42 }).notNull(),
    snapshotBlock: bigint('snapshot_block', { mode: 'bigint' }).notNull(),
    balanceRaw: numeric('balance_raw', { precision: 78, scale: 0 }).notNull(),
    costBasisRaw: numeric('cost_basis_raw', { precision: 78, scale: 0 }).notNull(),
    realizedPnlRaw: numeric('realized_pnl_raw', { precision: 78, scale: 0 }).notNull(),
    unrealizedPnlRaw: numeric('unrealized_pnl_raw', { precision: 78, scale: 0 }).notNull(),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('wallet_pnl_snapshots_chain_wallet_token_idx').on(
      table.chainId,
      table.walletAddress,
      table.tokenAddress,
    ),
    index('wallet_pnl_snapshots_block_idx').on(table.snapshotBlock),
    uniqueIndex('wallet_pnl_snapshots_chain_wallet_token_block_idx').on(
      table.chainId,
      table.walletAddress,
      table.tokenAddress,
      table.snapshotBlock,
    ),
  ],
);

export const walletCashFlows = pgTable(
  'wallet_cash_flows',
  {
    id: text('id').primaryKey(),
    chainId: integer('chain_id').notNull(),
    walletAddress: varchar('wallet_address', { length: 42 }).notNull(),
    tokenAddress: varchar('token_address', { length: 42 }).notNull(),
    txHash: varchar('tx_hash', { length: 66 }).notNull(),
    flowType: flowTypeEnum('flow_type').notNull(),
    amountRaw: numeric('amount_raw', { precision: 78, scale: 0 }).notNull(),
    blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('wallet_cash_flows_chain_wallet_token_idx').on(
      table.chainId,
      table.walletAddress,
      table.tokenAddress,
    ),
    index('wallet_cash_flows_tx_hash_idx').on(table.txHash),
    index('wallet_cash_flows_block_idx').on(table.blockNumber),
    uniqueIndex('wallet_cash_flows_chain_tx_token_idx').on(
      table.chainId,
      table.txHash,
      table.tokenAddress,
      table.flowType,
    ),
  ],
);

export const allowances = pgTable(
  'allowances',
  {
    chainId: integer('chain_id').notNull(),
    ownerAddress: varchar('owner_address', { length: 42 }).notNull(),
    tokenAddress: varchar('token_address', { length: 42 }).notNull(),
    spenderAddress: varchar('spender_address', { length: 42 }).notNull(),
    allowanceRaw: numeric('allowance_raw', { precision: 78, scale: 0 }).notNull(),
    lastUpdatedBlock: bigint('last_updated_block', { mode: 'bigint' }).notNull(),
    spenderClassification: text('spender_classification'),
    riskStatus: text('risk_status'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.chainId, table.ownerAddress, table.tokenAddress, table.spenderAddress],
    }),
    index('allowances_spender_idx').on(table.chainId, table.spenderAddress),
    index('allowances_risk_status_idx').on(table.riskStatus),
  ],
);

export const spenderClassifications = pgTable(
  'spender_classifications',
  {
    id: text('id').primaryKey(),
    chainId: integer('chain_id').notNull(),
    spenderAddress: varchar('spender_address', { length: 42 }).notNull(),
    classificationType: classificationTypeEnum('classification_type').notNull(),
    classificationValue: text('classification_value').notNull(),
    source: text('source').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('spender_classifications_chain_spender_type_idx').on(
      table.chainId,
      table.spenderAddress,
      table.classificationType,
    ),
    index('spender_classifications_chain_spender_idx').on(table.chainId, table.spenderAddress),
  ],
);
