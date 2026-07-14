DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pools LIMIT 1)
    OR EXISTS (SELECT 1 FROM swaps LIMIT 1)
    OR EXISTS (SELECT 1 FROM liquidity_events LIMIT 1) THEN
    RAISE EXCEPTION 'Migration 010 requires an explicit market-data backfill before replacing legacy protocol, pool, swap, and liquidity provenance';
  END IF;
END $$;

DO $$ BEGIN
  CREATE TYPE protocol_kind AS ENUM ('dex', 'launchpad');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE protocol_validation_status AS ENUM ('active', 'disabled', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE launchpad_trade_side AS ENUM ('buy', 'sell');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE liquidity_event_type AS ENUM (
    'liquidityAdded',
    'liquidityRemoved',
    'lpMinted',
    'lpBurned',
    'positionCreated',
    'positionIncreased',
    'positionDecreased',
    'feesCollected',
    'bondingCurveLiquidity',
    'migrationLiquidity'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE dex_protocols
  ADD COLUMN protocol_key TEXT,
  ADD COLUMN kind protocol_kind NOT NULL DEFAULT 'dex',
  ADD COLUMN registry_version TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN validation_status protocol_validation_status NOT NULL DEFAULT 'disabled',
  ADD COLUMN validated_at TIMESTAMPTZ,
  ADD COLUMN validation_expires_at TIMESTAMPTZ;

ALTER TABLE dex_protocols ALTER COLUMN factory_address DROP NOT NULL;

UPDATE dex_protocols SET protocol_key = lower(regexp_replace(protocol_name, '[^a-zA-Z0-9]+', '-', 'g'));
ALTER TABLE dex_protocols ALTER COLUMN protocol_key SET NOT NULL;
DROP INDEX IF EXISTS dex_protocols_chain_name_version_idx;
ALTER TABLE dex_protocols
  DROP CONSTRAINT IF EXISTS dex_protocols_chain_id_protocol_name_version_key;
CREATE UNIQUE INDEX dex_protocols_chain_name_version_idx
  ON dex_protocols(chain_id, protocol_key, version);

CREATE TABLE protocol_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id BIGINT NOT NULL REFERENCES dex_protocols(id),
  chain_id INTEGER NOT NULL,
  protocol_key TEXT NOT NULL,
  protocol_version TEXT NOT NULL,
  contract_role TEXT NOT NULL,
  address TEXT NOT NULL,
  official_source_url TEXT NOT NULL,
  explorer_url TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL,
  expected_runtime_bytecode_hash TEXT NOT NULL,
  proxy_type TEXT,
  implementation_address TEXT,
  admin_address TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX protocol_contracts_role_idx
  ON protocol_contracts(chain_id, protocol_key, protocol_version, contract_role);
CREATE UNIQUE INDEX protocol_contracts_address_idx
  ON protocol_contracts(chain_id, protocol_key, protocol_version, address);

CREATE TABLE protocol_contract_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_contract_id UUID NOT NULL REFERENCES protocol_contracts(id),
  chain_id INTEGER NOT NULL,
  observed_runtime_bytecode_hash TEXT,
  observed_implementation_address TEXT,
  observed_admin_address TEXT,
  valid BOOLEAN NOT NULL,
  failure_code TEXT,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  checked_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX protocol_contract_verifications_contract_idx
  ON protocol_contract_verifications(protocol_contract_id, checked_at);

ALTER TABLE pools
  ADD COLUMN protocol_key TEXT,
  ADD COLUMN protocol_version TEXT,
  ADD COLUMN factory_address TEXT,
  ADD COLUMN tick_spacing INTEGER,
  ADD COLUMN pool_type TEXT,
  ADD COLUMN created_block_hash TEXT,
  ADD COLUMN creation_log_index INTEGER,
  ADD COLUMN canonical BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN state JSONB,
  ADD COLUMN state_block_number BIGINT;

ALTER TABLE pools
  ALTER COLUMN protocol_key SET NOT NULL,
  ALTER COLUMN protocol_version SET NOT NULL,
  ALTER COLUMN factory_address SET NOT NULL,
  ALTER COLUMN pool_type SET NOT NULL,
  ALTER COLUMN created_block_hash SET NOT NULL,
  ALTER COLUMN creation_log_index SET NOT NULL,
  ALTER COLUMN fee_tier TYPE NUMERIC(78,0),
  ALTER COLUMN fee_tier DROP NOT NULL;

ALTER TABLE pool_tokens RENAME COLUMN pool_chain_id TO chain_id;
DROP INDEX IF EXISTS idx_pool_tokens_chain_token;
CREATE INDEX pool_tokens_token_idx ON pool_tokens(chain_id, token_address);

DROP INDEX IF EXISTS swaps_chain_tx_log_idx;
ALTER TABLE swaps
  DROP CONSTRAINT IF EXISTS swaps_chain_id_transaction_hash_log_index_key;
ALTER TABLE swaps
  DROP COLUMN sender,
  DROP COLUMN recipient,
  DROP COLUMN amount0_raw,
  DROP COLUMN amount1_raw,
  DROP COLUMN sqrt_price_x96,
  DROP COLUMN liquidity,
  DROP COLUMN tick,
  DROP COLUMN normalized_usd_value,
  DROP COLUMN price_impact_estimate,
  ADD COLUMN protocol_key TEXT NOT NULL,
  ADD COLUMN protocol_version TEXT NOT NULL,
  ADD COLUMN sender_address TEXT,
  ADD COLUMN recipient_address TEXT,
  ADD COLUMN token_in_address TEXT NOT NULL,
  ADD COLUMN token_out_address TEXT NOT NULL,
  ADD COLUMN amount_in_raw NUMERIC(78,0) NOT NULL,
  ADD COLUMN amount_out_raw NUMERIC(78,0) NOT NULL,
  ADD COLUMN fee_raw NUMERIC(78,0),
  ADD COLUMN canonical BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX swaps_chain_block_tx_log_idx
  ON swaps(chain_id, block_hash, transaction_hash, log_index);

DROP INDEX IF EXISTS liquidity_events_chain_tx_log_idx;
ALTER TABLE liquidity_events
  DROP CONSTRAINT IF EXISTS liquidity_events_chain_id_transaction_hash_log_index_key,
  DROP CONSTRAINT IF EXISTS liquidity_events_event_type_check,
  ALTER COLUMN event_type TYPE liquidity_event_type
    USING (
      CASE event_type
        WHEN 'mint' THEN 'lpMinted'
        WHEN 'burn' THEN 'lpBurned'
        WHEN 'add' THEN 'liquidityAdded'
        WHEN 'remove' THEN 'liquidityRemoved'
        ELSE 'liquidityAdded'
      END
    )::liquidity_event_type;
ALTER TABLE liquidity_events
  DROP COLUMN usd_estimate,
  ALTER COLUMN provider_address DROP NOT NULL,
  ALTER COLUMN owner_address DROP NOT NULL,
  ADD COLUMN protocol_key TEXT NOT NULL,
  ADD COLUMN protocol_version TEXT NOT NULL,
  ADD COLUMN recipient_address TEXT,
  ADD COLUMN token0_address TEXT NOT NULL,
  ADD COLUMN token1_address TEXT NOT NULL,
  ADD COLUMN position_id NUMERIC(78,0),
  ADD COLUMN tick_lower INTEGER,
  ADD COLUMN tick_upper INTEGER,
  ADD COLUMN canonical BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX liquidity_events_chain_block_tx_log_idx
  ON liquidity_events(chain_id, block_hash, transaction_hash, log_index);

CREATE TABLE protocol_quotes (
  quote_id TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  protocol_key TEXT NOT NULL,
  protocol_version TEXT NOT NULL,
  input_token_address TEXT NOT NULL,
  output_token_address TEXT NOT NULL,
  amount_in_raw NUMERIC(78,0) NOT NULL,
  expected_amount_out_raw NUMERIC(78,0) NOT NULL,
  minimum_amount_out_raw NUMERIC(78,0) NOT NULL,
  source_block_number BIGINT NOT NULL,
  route JSONB NOT NULL,
  warnings JSONB NOT NULL,
  transaction_target TEXT NOT NULL,
  transaction_selector TEXT NOT NULL,
  spender_address TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX protocol_quotes_expiry_idx ON protocol_quotes(expires_at);

CREATE TABLE launchpad_tokens (
  chain_id INTEGER NOT NULL,
  protocol_key TEXT NOT NULL,
  protocol_version TEXT NOT NULL,
  token_address TEXT NOT NULL,
  creator_address TEXT NOT NULL,
  token_implementation_address TEXT,
  initial_supply_raw NUMERIC(78,0) NOT NULL,
  bonding_curve_address TEXT,
  block_number BIGINT NOT NULL,
  block_hash TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  canonical BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, token_address, block_hash),
  UNIQUE (chain_id, block_hash, transaction_hash, log_index)
);

CREATE TABLE launchpad_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id INTEGER NOT NULL,
  protocol_key TEXT NOT NULL,
  protocol_version TEXT NOT NULL,
  token_address TEXT NOT NULL,
  bonding_curve_address TEXT NOT NULL,
  trader_address TEXT NOT NULL,
  side launchpad_trade_side NOT NULL,
  token_amount_raw NUMERIC(78,0) NOT NULL,
  payment_amount_raw NUMERIC(78,0) NOT NULL,
  creator_fee_raw NUMERIC(78,0),
  protocol_fee_raw NUMERIC(78,0),
  block_number BIGINT NOT NULL,
  block_hash TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  canonical BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, block_hash, transaction_hash, log_index)
);

CREATE TABLE launchpad_creator_fee_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id INTEGER NOT NULL,
  protocol_key TEXT NOT NULL,
  protocol_version TEXT NOT NULL,
  token_address TEXT NOT NULL,
  bonding_curve_address TEXT NOT NULL,
  trader_address TEXT NOT NULL,
  amount_raw NUMERIC(78,0) NOT NULL,
  block_number BIGINT NOT NULL,
  block_hash TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  canonical BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, block_hash, transaction_hash, log_index)
);

CREATE TABLE launchpad_graduations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id INTEGER NOT NULL,
  protocol_key TEXT NOT NULL,
  protocol_version TEXT NOT NULL,
  token_address TEXT NOT NULL,
  bonding_curve_address TEXT NOT NULL,
  graduation_threshold_raw NUMERIC(78,0),
  block_number BIGINT NOT NULL,
  block_hash TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  canonical BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, block_hash, transaction_hash, log_index)
);

CREATE TABLE launchpad_migrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id INTEGER NOT NULL,
  protocol_key TEXT NOT NULL,
  protocol_version TEXT NOT NULL,
  token_address TEXT NOT NULL,
  migration_address TEXT NOT NULL,
  destination_protocol_key TEXT NOT NULL,
  destination_pool_address TEXT NOT NULL,
  token_liquidity_raw NUMERIC(78,0),
  paired_liquidity_raw NUMERIC(78,0),
  block_number BIGINT NOT NULL,
  block_hash TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  canonical BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, block_hash, transaction_hash, log_index)
);
