TRUNCATE TABLE wallet_token_lots, wallet_pnl_snapshots, wallet_cash_flows;

ALTER TABLE wallet_token_lots
  ALTER COLUMN unit_cost_raw DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS acquisition_block BIGINT NOT NULL,
  ADD COLUMN IF NOT EXISTS acquisition_block_hash TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS acquisition_log_index INTEGER NOT NULL,
  ADD COLUMN IF NOT EXISTS total_cost_raw NUMERIC(78,0),
  ADD COLUMN IF NOT EXISTS quote_asset_address TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS source_block BIGINT NOT NULL,
  ADD COLUMN IF NOT EXISTS source_block_hash TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS canonical BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE wallet_pnl_snapshots
  ALTER COLUMN cost_basis_raw DROP NOT NULL,
  ALTER COLUMN realized_pnl_raw DROP NOT NULL,
  ALTER COLUMN unrealized_pnl_raw DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS quote_asset_address TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS quote_decimals INTEGER NOT NULL,
  ADD COLUMN IF NOT EXISTS methodology TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS incomplete_history BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_block_hash TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS canonical BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE wallet_cash_flows
  ADD COLUMN IF NOT EXISTS log_index INTEGER NOT NULL,
  ADD COLUMN IF NOT EXISTS block_hash TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS quote_asset_address TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS canonical BOOLEAN NOT NULL DEFAULT true;

DROP INDEX IF EXISTS wallet_cash_flows_chain_tx_token_idx;

CREATE UNIQUE INDEX IF NOT EXISTS wallet_cash_flows_event_idx
  ON wallet_cash_flows (
    chain_id, wallet_address, tx_hash, log_index, token_address, flow_type
  );

CREATE UNIQUE INDEX IF NOT EXISTS wallet_pnl_snapshots_chain_wallet_token_block_idx
  ON wallet_pnl_snapshots (chain_id, wallet_address, token_address, snapshot_block);

CREATE INDEX IF NOT EXISTS wallet_token_lots_source_block_idx
  ON wallet_token_lots (chain_id, source_block, canonical);

CREATE INDEX IF NOT EXISTS wallet_pnl_snapshots_source_block_idx
  ON wallet_pnl_snapshots (chain_id, snapshot_block, canonical);

CREATE INDEX IF NOT EXISTS wallet_cash_flows_canonical_block_idx
  ON wallet_cash_flows (chain_id, block_number, canonical);
