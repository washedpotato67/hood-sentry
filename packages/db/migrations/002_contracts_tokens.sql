-- Migration: 002_contracts_tokens
-- Created: 2026-07-13
-- Description: Contracts and tokens domain tables

-- Contracts
CREATE TABLE IF NOT EXISTS contracts (
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  address TEXT NOT NULL,
  creator_address TEXT NOT NULL,
  creation_tx_hash TEXT NOT NULL,
  creation_block BIGINT NOT NULL,
  bytecode_hash TEXT,
  runtime_bytecode TEXT,
  is_proxy BOOLEAN NOT NULL DEFAULT false,
  proxy_type TEXT,
  implementation_address TEXT,
  proxy_admin_address TEXT,
  verified BOOLEAN NOT NULL DEFAULT false,
  source_provider TEXT,
  source_fetched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, address)
);

CREATE INDEX idx_contracts_chain_creator ON contracts(chain_id, creator_address);
CREATE INDEX idx_contracts_chain_verified ON contracts(chain_id, verified) WHERE verified = true;
CREATE INDEX idx_contracts_chain_proxy ON contracts(chain_id, is_proxy) WHERE is_proxy = true;

-- Contract sources
CREATE TABLE IF NOT EXISTS contract_sources (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  address TEXT NOT NULL,
  source_code TEXT NOT NULL,
  compiler_version TEXT NOT NULL,
  compiler_settings JSONB,
  abi JSONB,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, address)
);

CREATE INDEX idx_contract_sources_chain_address ON contract_sources(chain_id, address);

-- Contract ABIs
CREATE TABLE IF NOT EXISTS contract_abis (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  address TEXT NOT NULL,
  abi JSONB NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('verified', 'guessed', 'manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, address, source)
);

CREATE INDEX idx_contract_abis_chain_address ON contract_abis(chain_id, address);

-- Proxy relationships
CREATE TABLE IF NOT EXISTS proxy_relationships (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  proxy_address TEXT NOT NULL,
  implementation_address TEXT NOT NULL,
  proxy_type TEXT NOT NULL,
  admin_address TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, proxy_address, implementation_address)
);

CREATE INDEX idx_proxy_relationships_chain_proxy ON proxy_relationships(chain_id, proxy_address);
CREATE INDEX idx_proxy_relationships_chain_impl ON proxy_relationships(chain_id, implementation_address);

-- Tokens
CREATE TABLE IF NOT EXISTS tokens (
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  address TEXT NOT NULL,
  name TEXT,
  symbol TEXT,
  decimals INTEGER,
  total_supply_raw NUMERIC(78,0),
  token_type TEXT NOT NULL CHECK (token_type IN ('erc20', 'erc721', 'erc1155', 'stock_token', 'etf_token', 'unknown')),
  canonical_asset_key TEXT,
  logo_uri TEXT,
  metadata_status TEXT NOT NULL CHECK (metadata_status IN ('pending', 'complete', 'failed')) DEFAULT 'pending',
  spam_status TEXT NOT NULL CHECK (spam_status IN ('unknown', 'not_spam', 'spam')) DEFAULT 'unknown',
  first_seen_block BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, address)
);

CREATE INDEX idx_tokens_chain_symbol ON tokens(chain_id, symbol);
CREATE INDEX idx_tokens_chain_type ON tokens(chain_id, token_type);
CREATE INDEX idx_tokens_chain_spam ON tokens(chain_id, spam_status);
CREATE INDEX idx_tokens_created_at ON tokens(created_at);

-- Stock token metadata
CREATE TABLE IF NOT EXISTS stock_token_metadata (
  token_chain_id INTEGER NOT NULL,
  token_address TEXT NOT NULL,
  underlying_ticker TEXT NOT NULL,
  official BOOLEAN NOT NULL DEFAULT false,
  ui_multiplier_raw NUMERIC(78,0) NOT NULL DEFAULT 1,
  pending_multiplier_raw NUMERIC(78,0),
  multiplier_effective_at TIMESTAMPTZ,
  oracle_paused BOOLEAN NOT NULL DEFAULT false,
  feed_address TEXT,
  feed_decimals INTEGER,
  heartbeat_seconds INTEGER,
  source_url TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (token_chain_id, token_address),
  FOREIGN KEY (token_chain_id, token_address) REFERENCES tokens(chain_id, address) ON DELETE CASCADE
);

CREATE INDEX idx_stock_token_metadata_ticker ON stock_token_metadata(underlying_ticker);
CREATE INDEX idx_stock_token_metadata_official ON stock_token_metadata(official) WHERE official = true;

-- Token transfers
CREATE TABLE IF NOT EXISTS token_transfers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  block_number BIGINT NOT NULL,
  block_hash TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  token_address TEXT NOT NULL,
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  amount_raw NUMERIC(78,0) NOT NULL,
  ui_amount_raw NUMERIC(78,0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, transaction_hash, log_index)
);

CREATE INDEX idx_token_transfers_chain_token ON token_transfers(chain_id, token_address);
CREATE INDEX idx_token_transfers_chain_from ON token_transfers(chain_id, from_address);
CREATE INDEX idx_token_transfers_chain_to ON token_transfers(chain_id, to_address);
CREATE INDEX idx_token_transfers_chain_block ON token_transfers(chain_id, block_number);
CREATE INDEX idx_token_transfers_created_at ON token_transfers(created_at);

-- Token approvals
CREATE TABLE IF NOT EXISTS token_approvals (
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  owner_address TEXT NOT NULL,
  token_address TEXT NOT NULL,
  spender_address TEXT NOT NULL,
  allowance_raw NUMERIC(78,0) NOT NULL,
  last_updated_block BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, owner_address, token_address, spender_address)
);

CREATE INDEX idx_token_approvals_chain_owner ON token_approvals(chain_id, owner_address);
CREATE INDEX idx_token_approvals_chain_token ON token_approvals(chain_id, token_address);
CREATE INDEX idx_token_approvals_chain_spender ON token_approvals(chain_id, spender_address);

-- Token balances
CREATE TABLE IF NOT EXISTS token_balances (
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  token_address TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  balance_raw NUMERIC(78,0) NOT NULL DEFAULT 0,
  as_of_block BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, token_address, wallet_address)
);

CREATE INDEX idx_token_balances_chain_wallet ON token_balances(chain_id, wallet_address);
CREATE INDEX idx_token_balances_chain_token ON token_balances(chain_id, token_address);

-- Holder snapshots
CREATE TABLE IF NOT EXISTS holder_snapshots (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  token_address TEXT NOT NULL,
  snapshot_block BIGINT NOT NULL,
  holder_count INTEGER NOT NULL,
  top_10_bps INTEGER NOT NULL,
  top_20_bps INTEGER NOT NULL,
  gini_scaled NUMERIC(5,4) NOT NULL,
  circulating_supply_raw NUMERIC(78,0) NOT NULL,
  classification_exclusions JSONB,
  methodology_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, token_address, snapshot_block)
);

CREATE INDEX idx_holder_snapshots_chain_token ON holder_snapshots(chain_id, token_address);
CREATE INDEX idx_holder_snapshots_chain_block ON holder_snapshots(chain_id, snapshot_block);
