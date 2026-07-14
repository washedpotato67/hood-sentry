CREATE TYPE explorer_verification_status AS ENUM (
  'fully_verified',
  'partially_verified',
  'verified',
  'unverified'
);
CREATE TYPE data_quality_warning_status AS ENUM ('open', 'resolved');

CREATE TABLE explorer_contract_metadata (
  chain_id INTEGER NOT NULL,
  address VARCHAR(42) NOT NULL,
  provider VARCHAR(64) NOT NULL,
  provider_url TEXT NOT NULL,
  provider_endpoints JSONB NOT NULL,
  cache_key VARCHAR(256) NOT NULL,
  cache_entry JSONB NOT NULL,
  verification_status explorer_verification_status NOT NULL,
  source_files JSONB NOT NULL,
  source_hash VARCHAR(66),
  abi JSONB,
  compiler_version VARCHAR(128),
  optimizer_enabled BOOLEAN,
  optimizer_runs INTEGER,
  compiler_settings JSONB,
  constructor_arguments TEXT,
  contract_name VARCHAR(256),
  proxy_metadata JSONB NOT NULL,
  token_labels JSONB NOT NULL,
  raw_response JSONB NOT NULL,
  warnings JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, address, provider)
);

CREATE INDEX explorer_contract_metadata_expiry_idx
  ON explorer_contract_metadata (expires_at);

CREATE UNIQUE INDEX explorer_contract_metadata_cache_key_uidx
  ON explorer_contract_metadata (cache_key);

CREATE TABLE data_quality_warnings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fingerprint VARCHAR(66) NOT NULL,
  chain_id INTEGER NOT NULL,
  address VARCHAR(42) NOT NULL,
  category VARCHAR(64) NOT NULL,
  field VARCHAR(64) NOT NULL,
  chain_value JSONB,
  provider_value JSONB,
  provider VARCHAR(64) NOT NULL,
  provider_fetched_at TIMESTAMPTZ NOT NULL,
  status data_quality_warning_status NOT NULL DEFAULT 'open',
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX data_quality_warnings_fingerprint_uidx
  ON data_quality_warnings (fingerprint);

CREATE INDEX data_quality_warnings_contract_idx
  ON data_quality_warnings (chain_id, address, status);
