-- Migration: 005_wallet_portfolio
-- Created: 2026-07-13
-- Description: Wallet and portfolio domain tables

-- Wallets
CREATE TABLE IF NOT EXISTS wallets (
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  address TEXT NOT NULL,
  first_seen_block BIGINT,
  user_owned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, address)
);

CREATE INDEX idx_wallets_chain_first_seen ON wallets(chain_id, first_seen_block);
CREATE INDEX idx_wallets_user_owned ON wallets(user_owned) WHERE user_owned = true;

-- Wallet labels
CREATE TABLE IF NOT EXISTS wallet_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  address TEXT NOT NULL,
  label_type TEXT NOT NULL CHECK (label_type IN ('exchange', 'defi', 'nft', 'governance', 'bridge', 'miner', 'other')),
  label_value TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence NUMERIC(3,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, address, label_type, label_value)
);

CREATE INDEX idx_wallet_labels_chain_address ON wallet_labels(chain_id, address);
CREATE INDEX idx_wallet_labels_chain_type ON wallet_labels(chain_id, label_type);

-- Wallet token lots
CREATE TABLE IF NOT EXISTS wallet_token_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  wallet_address TEXT NOT NULL,
  token_address TEXT NOT NULL,
  acquisition_tx_hash TEXT NOT NULL,
  amount_raw NUMERIC(78,0) NOT NULL,
  unit_cost_raw NUMERIC(78,0) NOT NULL,
  unit_cost_decimals INTEGER NOT NULL,
  remaining_amount_raw NUMERIC(78,0) NOT NULL,
  methodology TEXT NOT NULL CHECK (methodology IN ('fifo', 'lifo', 'average')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wallet_token_lots_chain_wallet ON wallet_token_lots(chain_id, wallet_address);
CREATE INDEX idx_wallet_token_lots_chain_token ON wallet_token_lots(chain_id, token_address);
CREATE INDEX idx_wallet_token_lots_remaining ON wallet_token_lots(remaining_amount_raw) WHERE remaining_amount_raw > 0;

-- Wallet PnL snapshots
CREATE TABLE IF NOT EXISTS wallet_pnl_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  wallet_address TEXT NOT NULL,
  token_address TEXT NOT NULL,
  snapshot_block BIGINT NOT NULL,
  balance_raw NUMERIC(78,0) NOT NULL,
  cost_basis_raw NUMERIC(78,0) NOT NULL,
  realized_pnl_raw NUMERIC(78,0) NOT NULL,
  unrealized_pnl_raw NUMERIC(78,0) NOT NULL,
  confidence NUMERIC(3,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, wallet_address, token_address, snapshot_block)
);

CREATE INDEX idx_wallet_pnl_snapshots_chain_wallet ON wallet_pnl_snapshots(chain_id, wallet_address);
CREATE INDEX idx_wallet_pnl_snapshots_chain_token ON wallet_pnl_snapshots(chain_id, token_address);
CREATE INDEX idx_wallet_pnl_snapshots_chain_block ON wallet_pnl_snapshots(chain_id, snapshot_block);

-- Wallet cash flows
CREATE TABLE IF NOT EXISTS wallet_cash_flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  wallet_address TEXT NOT NULL,
  token_address TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  flow_type TEXT NOT NULL CHECK (flow_type IN ('inflow', 'outflow')),
  amount_raw NUMERIC(78,0) NOT NULL,
  block_number BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wallet_cash_flows_chain_wallet ON wallet_cash_flows(chain_id, wallet_address);
CREATE INDEX idx_wallet_cash_flows_chain_token ON wallet_cash_flows(chain_id, token_address);
CREATE INDEX idx_wallet_cash_flows_chain_block ON wallet_cash_flows(chain_id, block_number);
CREATE INDEX idx_wallet_cash_flows_tx ON wallet_cash_flows(tx_hash);

-- Allowances
CREATE TABLE IF NOT EXISTS allowances (
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  owner_address TEXT NOT NULL,
  token_address TEXT NOT NULL,
  spender_address TEXT NOT NULL,
  allowance_raw NUMERIC(78,0) NOT NULL,
  last_updated_block BIGINT NOT NULL,
  spender_classification TEXT,
  risk_status TEXT CHECK (risk_status IN ('low', 'medium', 'high', 'critical')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, owner_address, token_address, spender_address)
);

CREATE INDEX idx_allowances_chain_owner ON allowances(chain_id, owner_address);
CREATE INDEX idx_allowances_chain_token ON allowances(chain_id, token_address);
CREATE INDEX idx_allowances_chain_spender ON allowances(chain_id, spender_address);
CREATE INDEX idx_allowances_risk ON allowances(risk_status) WHERE risk_status IN ('high', 'critical');

-- Spender classifications
CREATE TABLE IF NOT EXISTS spender_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  spender_address TEXT NOT NULL,
  classification_type TEXT NOT NULL CHECK (classification_type IN ('dex', 'lending', 'bridge', 'nft_marketplace', 'governance', 'other')),
  classification_value TEXT NOT NULL,
  source TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, spender_address, classification_type)
);

CREATE INDEX idx_spender_classifications_chain_spender ON spender_classifications(chain_id, spender_address);
CREATE INDEX idx_spender_classifications_chain_type ON spender_classifications(chain_id, classification_type);
