-- Migration: 017_liquidity_risk_context
-- Created: 2026-07-15
-- Description: Persist block-pinned pool observations and independently verified
-- liquidity lock evidence for deterministic risk scans.

ALTER TABLE pools
  ADD COLUMN IF NOT EXISTS state_block_hash TEXT;

-- Redelivery must collapse onto the original derived Transfer fact. Existing rows
-- predate the natural key, so retain the earliest copy before adding the constraint.
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY chain_id, block_hash, transaction_hash, log_index
      ORDER BY id
    ) AS rank
  FROM token_transfers
)
DELETE FROM token_transfers
WHERE id IN (SELECT id FROM ranked WHERE rank > 1);

CREATE UNIQUE INDEX IF NOT EXISTS token_transfers_chain_log_idx
  ON token_transfers(chain_id, block_hash, transaction_hash, log_index);

-- A duplicate transfer written before the natural key existed also inflated the
-- current balance projection. Rebuild every balance from the deduplicated canonical
-- history so the migration does not leave stale derived state behind.
TRUNCATE TABLE token_balances;

WITH holder_addresses AS (
  SELECT chain_id, token_address, from_address AS wallet_address
  FROM token_transfers
  WHERE canonical = true
    AND from_address <> '0x0000000000000000000000000000000000000000'
  UNION
  SELECT chain_id, token_address, to_address AS wallet_address
  FROM token_transfers
  WHERE canonical = true
    AND to_address <> '0x0000000000000000000000000000000000000000'
), rebuilt AS (
  SELECT
    holder.chain_id,
    holder.token_address,
    holder.wallet_address,
    COALESCE(SUM(
      CASE WHEN transfer.to_address = holder.wallet_address THEN transfer.amount_raw ELSE 0 END
    ), 0) - COALESCE(SUM(
      CASE WHEN transfer.from_address = holder.wallet_address THEN transfer.amount_raw ELSE 0 END
    ), 0) AS balance_raw,
    COALESCE(MAX(transfer.block_number), 0) AS as_of_block
  FROM holder_addresses holder
  LEFT JOIN token_transfers transfer
    ON transfer.chain_id = holder.chain_id
   AND transfer.token_address = holder.token_address
   AND transfer.canonical = true
   AND (
     transfer.from_address = holder.wallet_address
     OR transfer.to_address = holder.wallet_address
   )
  GROUP BY holder.chain_id, holder.token_address, holder.wallet_address
)
INSERT INTO token_balances (
  chain_id, token_address, wallet_address, balance_raw, as_of_block
)
SELECT chain_id, token_address, wallet_address, balance_raw, as_of_block
FROM rebuilt;

CREATE TABLE IF NOT EXISTS pool_state_snapshots (
  chain_id INTEGER NOT NULL,
  pool_address TEXT NOT NULL,
  protocol_key TEXT NOT NULL,
  protocol_version TEXT NOT NULL,
  pool_type TEXT NOT NULL,
  source_block_number BIGINT NOT NULL,
  source_block_hash TEXT NOT NULL,
  reserve0_raw NUMERIC(78,0),
  reserve1_raw NUMERIC(78,0),
  lp_total_supply_raw NUMERIC(78,0),
  state JSONB NOT NULL,
  source_provider TEXT NOT NULL DEFAULT 'rpc',
  canonical BOOLEAN NOT NULL DEFAULT true,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, pool_address, source_block_hash)
);

CREATE INDEX IF NOT EXISTS pool_state_snapshots_pool_block_idx
  ON pool_state_snapshots(chain_id, pool_address, source_block_number);

CREATE INDEX IF NOT EXISTS pool_state_snapshots_canonical_idx
  ON pool_state_snapshots(chain_id, source_block_number, canonical);

CREATE TABLE IF NOT EXISTS liquidity_lock_evidence (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  pool_address TEXT NOT NULL,
  lock_contract_address TEXT NOT NULL,
  beneficiary_address TEXT NOT NULL,
  locked_amount_raw NUMERIC(78,0) NOT NULL CHECK (locked_amount_raw > 0),
  unlock_time TIMESTAMPTZ NOT NULL,
  withdrawal_conditions TEXT NOT NULL CHECK (length(trim(withdrawal_conditions)) > 0),
  verification_source TEXT NOT NULL CHECK (length(trim(verification_source)) > 0),
  verified_at TIMESTAMPTZ NOT NULL,
  verification_expires_at TIMESTAMPTZ NOT NULL,
  source_block_number BIGINT NOT NULL,
  source_block_hash TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL CHECK (log_index >= 0),
  methodology_version TEXT NOT NULL,
  canonical BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (verification_expires_at > verified_at),
  UNIQUE (chain_id, pool_address, source_block_hash, transaction_hash, log_index)
);

CREATE INDEX IF NOT EXISTS liquidity_lock_evidence_pool_idx
  ON liquidity_lock_evidence(chain_id, pool_address, source_block_number);
