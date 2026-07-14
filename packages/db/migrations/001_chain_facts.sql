-- Migration: 001_chain_facts
-- Created: 2026-07-13
-- Description: Chain facts domain tables

-- Chains registry
CREATE TABLE IF NOT EXISTS chains (
  chain_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  native_symbol TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  head_block_number BIGINT,
  finalized_block_number BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chains_enabled ON chains(enabled);

-- Blocks
CREATE TABLE IF NOT EXISTS blocks (
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  number BIGINT NOT NULL,
  hash TEXT NOT NULL,
  parent_hash TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  finality_state TEXT NOT NULL CHECK (finality_state IN ('pending', 'confirmed', 'finalized')),
  canonical BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, number, hash)
);

CREATE INDEX idx_blocks_chain_number ON blocks(chain_id, number);
CREATE INDEX idx_blocks_chain_canonical_number ON blocks(chain_id, canonical, number);
CREATE INDEX idx_blocks_canonical ON blocks(canonical) WHERE canonical = true;
CREATE INDEX idx_blocks_created_at ON blocks(created_at);

-- Transactions
CREATE TABLE IF NOT EXISTS transactions (
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  hash TEXT NOT NULL,
  block_number BIGINT NOT NULL,
  block_hash TEXT NOT NULL,
  from_address TEXT NOT NULL,
  to_address TEXT,
  nonce BIGINT NOT NULL,
  value_raw NUMERIC(78,0) NOT NULL DEFAULT 0,
  input TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'failed')),
  gas_used BIGINT,
  effective_gas_price BIGINT,
  contract_created TEXT,
  canonical BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, hash)
);

CREATE INDEX idx_transactions_chain_block ON transactions(chain_id, block_number);
CREATE INDEX idx_transactions_chain_from ON transactions(chain_id, from_address);
CREATE INDEX idx_transactions_chain_to ON transactions(chain_id, to_address);
CREATE INDEX idx_transactions_canonical ON transactions(canonical) WHERE canonical = true;
CREATE INDEX idx_transactions_created_at ON transactions(created_at);

-- Transaction receipts
CREATE TABLE IF NOT EXISTS transaction_receipts (
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  transaction_hash TEXT NOT NULL,
  block_number BIGINT NOT NULL,
  block_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  gas_used BIGINT NOT NULL,
  cumulative_gas_used BIGINT NOT NULL,
  logs_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, transaction_hash),
  FOREIGN KEY (chain_id, transaction_hash) REFERENCES transactions(chain_id, hash)
);

CREATE INDEX idx_transaction_receipts_chain_block ON transaction_receipts(chain_id, block_number);

-- Logs
CREATE TABLE IF NOT EXISTS logs (
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_hash TEXT NOT NULL,
  block_number BIGINT NOT NULL,
  address TEXT NOT NULL,
  topic0 TEXT,
  topic1 TEXT,
  topic2 TEXT,
  topic3 TEXT,
  data TEXT,
  removed BOOLEAN NOT NULL DEFAULT false,
  canonical BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, transaction_hash, log_index, block_hash),
  FOREIGN KEY (chain_id, transaction_hash) REFERENCES transactions(chain_id, hash)
);

CREATE INDEX idx_logs_chain_address ON logs(chain_id, address);
CREATE INDEX idx_logs_chain_block ON logs(chain_id, block_number);
CREATE INDEX idx_logs_chain_topic0 ON logs(chain_id, topic0);
CREATE INDEX idx_logs_canonical ON logs(canonical) WHERE canonical = true;
CREATE INDEX idx_logs_created_at ON logs(created_at);

-- Indexer checkpoints
CREATE TABLE IF NOT EXISTS indexer_checkpoints (
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  stream TEXT NOT NULL,
  next_block BIGINT NOT NULL,
  last_block_hash TEXT,
  locked_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, stream)
);

-- Indexer leases
CREATE TABLE IF NOT EXISTS indexer_leases (
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  stream TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, stream, worker_id)
);

CREATE INDEX idx_indexer_leases_expires ON indexer_leases(expires_at);

-- Reorg events
CREATE TABLE IF NOT EXISTS reorg_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  from_block BIGINT NOT NULL,
  to_block BIGINT NOT NULL,
  common_ancestor_block BIGINT NOT NULL,
  blocks_orphaned INTEGER NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reorg_events_chain ON reorg_events(chain_id);
CREATE INDEX idx_reorg_events_detected ON reorg_events(detected_at);
