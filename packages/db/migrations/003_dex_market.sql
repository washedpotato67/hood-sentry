-- Migration: 003_dex_market
-- Created: 2026-07-13
-- Description: DEX and market data domain tables

-- DEX protocols
CREATE TABLE IF NOT EXISTS dex_protocols (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  protocol_name TEXT NOT NULL,
  version TEXT NOT NULL,
  factory_address TEXT,
  router_address TEXT,
  quoter_address TEXT,
  verification_source TEXT NOT NULL,
  verification_date TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, protocol_name, version)
);

CREATE INDEX idx_dex_protocols_chain ON dex_protocols(chain_id);

-- Pools
CREATE TABLE IF NOT EXISTS pools (
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  address TEXT NOT NULL,
  protocol_id BIGINT NOT NULL REFERENCES dex_protocols(id),
  token0_address TEXT NOT NULL,
  token1_address TEXT NOT NULL,
  fee_tier INTEGER NOT NULL,
  created_block BIGINT NOT NULL,
  created_tx_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, address)
);

CREATE INDEX idx_pools_chain_protocol ON pools(chain_id, protocol_id);
CREATE INDEX idx_pools_chain_token0 ON pools(chain_id, token0_address);
CREATE INDEX idx_pools_chain_token1 ON pools(chain_id, token1_address);
CREATE INDEX idx_pools_active ON pools(active) WHERE active = true;

-- Pool tokens
CREATE TABLE IF NOT EXISTS pool_tokens (
  pool_chain_id INTEGER NOT NULL,
  pool_address TEXT NOT NULL,
  token_address TEXT NOT NULL,
  reserve_raw NUMERIC(78,0) NOT NULL DEFAULT 0,
  weight NUMERIC(5,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pool_chain_id, pool_address, token_address),
  FOREIGN KEY (pool_chain_id, pool_address) REFERENCES pools(chain_id, address) ON DELETE CASCADE
);

CREATE INDEX idx_pool_tokens_chain_token ON pool_tokens(pool_chain_id, token_address);

-- Swaps
CREATE TABLE IF NOT EXISTS swaps (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  block_number BIGINT NOT NULL,
  block_hash TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  pool_address TEXT NOT NULL,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  amount0_raw NUMERIC(78,0) NOT NULL,
  amount1_raw NUMERIC(78,0) NOT NULL,
  sqrt_price_x96 NUMERIC(78,0),
  liquidity NUMERIC(78,0),
  tick INTEGER,
  normalized_usd_value NUMERIC(78,0),
  price_impact_estimate NUMERIC(78,0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, transaction_hash, log_index)
);

CREATE INDEX idx_swaps_chain_pool ON swaps(chain_id, pool_address);
CREATE INDEX idx_swaps_chain_block ON swaps(chain_id, block_number);
CREATE INDEX idx_swaps_chain_sender ON swaps(chain_id, sender);
CREATE INDEX idx_swaps_chain_recipient ON swaps(chain_id, recipient);
CREATE INDEX idx_swaps_created_at ON swaps(created_at);

-- Liquidity events
CREATE TABLE IF NOT EXISTS liquidity_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  block_number BIGINT NOT NULL,
  block_hash TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  pool_address TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('mint', 'burn', 'add', 'remove')),
  provider_address TEXT NOT NULL,
  owner_address TEXT NOT NULL,
  token0_amount_raw NUMERIC(78,0) NOT NULL,
  token1_amount_raw NUMERIC(78,0) NOT NULL,
  usd_estimate NUMERIC(78,0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, transaction_hash, log_index)
);

CREATE INDEX idx_liquidity_events_chain_pool ON liquidity_events(chain_id, pool_address);
CREATE INDEX idx_liquidity_events_chain_block ON liquidity_events(chain_id, block_number);
CREATE INDEX idx_liquidity_events_chain_provider ON liquidity_events(chain_id, provider_address);
CREATE INDEX idx_liquidity_events_created_at ON liquidity_events(created_at);

-- Price observations
CREATE TABLE IF NOT EXISTS price_observations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  asset_key TEXT NOT NULL,
  source TEXT NOT NULL,
  price_raw NUMERIC(78,0) NOT NULL,
  decimals INTEGER NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  source_timestamp TIMESTAMPTZ,
  stale BOOLEAN NOT NULL DEFAULT false,
  confidence NUMERIC(3,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  status TEXT NOT NULL CHECK (status IN ('ok', 'stale', 'error')),
  block_number BIGINT,
  block_hash TEXT,
  transaction_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_price_observations_chain_asset ON price_observations(chain_id, asset_key);
CREATE INDEX idx_price_observations_chain_observed ON price_observations(chain_id, observed_at);
CREATE INDEX idx_price_observations_chain_source ON price_observations(chain_id, source);

-- Token metrics 1m
CREATE TABLE IF NOT EXISTS token_metrics_1m (
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  token_address TEXT NOT NULL,
  bucket_start TIMESTAMPTZ NOT NULL,
  open_price NUMERIC(78,0),
  high_price NUMERIC(78,0),
  low_price NUMERIC(78,0),
  close_price NUMERIC(78,0),
  volume NUMERIC(78,0) NOT NULL DEFAULT 0,
  buys INTEGER NOT NULL DEFAULT 0,
  sells INTEGER NOT NULL DEFAULT 0,
  unique_traders INTEGER NOT NULL DEFAULT 0,
  liquidity NUMERIC(78,0) NOT NULL DEFAULT 0,
  market_cap NUMERIC(78,0),
  fdv NUMERIC(78,0),
  holder_count INTEGER NOT NULL DEFAULT 0,
  holder_growth INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, token_address, bucket_start)
);

CREATE INDEX idx_token_metrics_1m_chain_token ON token_metrics_1m(chain_id, token_address);
CREATE INDEX idx_token_metrics_1m_chain_bucket ON token_metrics_1m(chain_id, bucket_start);

-- Token metrics 1h
CREATE TABLE IF NOT EXISTS token_metrics_1h (
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  token_address TEXT NOT NULL,
  bucket_start TIMESTAMPTZ NOT NULL,
  open_price NUMERIC(78,0),
  high_price NUMERIC(78,0),
  low_price NUMERIC(78,0),
  close_price NUMERIC(78,0),
  volume NUMERIC(78,0) NOT NULL DEFAULT 0,
  buys INTEGER NOT NULL DEFAULT 0,
  sells INTEGER NOT NULL DEFAULT 0,
  unique_traders INTEGER NOT NULL DEFAULT 0,
  liquidity NUMERIC(78,0) NOT NULL DEFAULT 0,
  market_cap NUMERIC(78,0),
  fdv NUMERIC(78,0),
  holder_count INTEGER NOT NULL DEFAULT 0,
  holder_growth INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, token_address, bucket_start)
);

CREATE INDEX idx_token_metrics_1h_chain_token ON token_metrics_1h(chain_id, token_address);
CREATE INDEX idx_token_metrics_1h_chain_bucket ON token_metrics_1h(chain_id, bucket_start);

-- Token metrics 1d
CREATE TABLE IF NOT EXISTS token_metrics_1d (
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  token_address TEXT NOT NULL,
  bucket_start TIMESTAMPTZ NOT NULL,
  open_price NUMERIC(78,0),
  high_price NUMERIC(78,0),
  low_price NUMERIC(78,0),
  close_price NUMERIC(78,0),
  volume NUMERIC(78,0) NOT NULL DEFAULT 0,
  buys INTEGER NOT NULL DEFAULT 0,
  sells INTEGER NOT NULL DEFAULT 0,
  unique_traders INTEGER NOT NULL DEFAULT 0,
  liquidity NUMERIC(78,0) NOT NULL DEFAULT 0,
  market_cap NUMERIC(78,0),
  fdv NUMERIC(78,0),
  holder_count INTEGER NOT NULL DEFAULT 0,
  holder_growth INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, token_address, bucket_start)
);

CREATE INDEX idx_token_metrics_1d_chain_token ON token_metrics_1d(chain_id, token_address);
CREATE INDEX idx_token_metrics_1d_chain_bucket ON token_metrics_1d(chain_id, bucket_start);

-- Market data sources
CREATE TABLE IF NOT EXISTS market_data_sources (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL CHECK (source_type IN ('api', 'websocket', 'file')),
  api_endpoint TEXT,
  api_key_env_var TEXT,
  rate_limit_per_minute INTEGER,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_market_data_sources_enabled ON market_data_sources(enabled) WHERE enabled = true;
