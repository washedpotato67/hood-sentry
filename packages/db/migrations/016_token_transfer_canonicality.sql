-- Migration: 016_token_transfer_canonicality
-- Created: 2026-07-15
-- Description: Make token_transfers reorg-aware so balances derived from it cannot
-- include transfers from abandoned forks.

-- Every other derived fact table (logs, swaps, liquidity_events, launchpad_*) carries
-- canonical and is invalidated when a reorg orphans its block range. token_transfers
-- did not, so a transfer from an orphaned fork stayed indistinguishable from a real one.
ALTER TABLE token_transfers
  ADD COLUMN IF NOT EXISTS canonical BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_token_transfers_canonical
  ON token_transfers(chain_id, token_address)
  WHERE canonical = true;

-- Balance projection reads a single holder's history for a token.
CREATE INDEX IF NOT EXISTS idx_token_transfers_from_canonical
  ON token_transfers(chain_id, token_address, from_address)
  WHERE canonical = true;

CREATE INDEX IF NOT EXISTS idx_token_transfers_to_canonical
  ON token_transfers(chain_id, token_address, to_address)
  WHERE canonical = true;
