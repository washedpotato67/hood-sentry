-- Migration: 025_transaction_intent_integrity
-- Created: 2026-07-15
-- Description: Bind simulated writes to wallets, selectors, decoded intent, quotes, and audit events.

ALTER TABLE transaction_intents
  ADD COLUMN IF NOT EXISTS intent_hash TEXT,
  ADD COLUMN IF NOT EXISTS wallet_address TEXT,
  ADD COLUMN IF NOT EXISTS function_selector TEXT,
  ADD COLUMN IF NOT EXISTS function_name TEXT,
  ADD COLUMN IF NOT EXISTS decoded_arguments JSONB,
  ADD COLUMN IF NOT EXISTS token_amounts JSONB,
  ADD COLUMN IF NOT EXISTS spender_address TEXT,
  ADD COLUMN IF NOT EXISTS approval_amount_raw NUMERIC(78,0),
  ADD COLUMN IF NOT EXISTS expected_result TEXT,
  ADD COLUMN IF NOT EXISTS feature_flag TEXT,
  ADD COLUMN IF NOT EXISTS configuration_version TEXT,
  ADD COLUMN IF NOT EXISTS quote_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS transaction_intents_intent_hash_idx
  ON transaction_intents(intent_hash)
  WHERE intent_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS transaction_intents_wallet_idx
  ON transaction_intents(chain_id, wallet_address, created_at);

CREATE TABLE IF NOT EXISTS transaction_intent_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_intent_id UUID NOT NULL REFERENCES transaction_intents(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (
    action IN ('created', 'reviewed', 'signed', 'broadcast', 'confirmed', 'reorged', 'rejected')
  ),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS transaction_intent_events_intent_idx
  ON transaction_intent_events(transaction_intent_id, created_at);
