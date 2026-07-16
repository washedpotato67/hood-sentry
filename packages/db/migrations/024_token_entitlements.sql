-- Migration: 024_token_entitlements
-- Created: 2026-07-15
-- Description: Persist reorg-traceable token access state and holding-duration candidates.

CREATE TABLE IF NOT EXISTS token_entitlement_states (
  chain_id INTEGER NOT NULL,
  token_address TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  eligible_tier TEXT NOT NULL CHECK (eligible_tier IN ('free', 'scout', 'analyst', 'sentinel')),
  granted_tier TEXT NOT NULL CHECK (granted_tier IN ('free', 'scout', 'analyst', 'sentinel')),
  candidate_tier TEXT CHECK (candidate_tier IN ('scout', 'analyst', 'sentinel')),
  candidate_since TIMESTAMPTZ,
  candidate_start_block BIGINT,
  balance_raw NUMERIC(78,0) NOT NULL CHECK (balance_raw >= 0),
  indexed_balance_raw NUMERIC(78,0) NOT NULL CHECK (indexed_balance_raw >= 0),
  observed_block BIGINT NOT NULL,
  observed_block_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('available', 'pending', 'unavailable')),
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  methodology_version TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, token_address, wallet_address)
);

CREATE INDEX IF NOT EXISTS token_entitlement_states_wallet_idx
  ON token_entitlement_states(chain_id, wallet_address, expires_at);
