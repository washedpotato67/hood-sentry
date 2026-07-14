CREATE TABLE IF NOT EXISTS price_source_configs (
  source_key TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('chainlink', 'launchpadBondingCurve', 'stablecoinPool', 'wethRoute', 'directDex', 'multihop', 'externalProvider', 'unavailable')),
  asset_class TEXT NOT NULL CHECK (asset_class IN ('erc20', 'wrappedEth', 'stablecoin', 'launchpad', 'migratedLaunchpad', 'stockToken', 'etfToken')),
  chain_id INTEGER NOT NULL,
  source_contract_address TEXT,
  source_asset_address TEXT NOT NULL,
  quote_asset_address TEXT NOT NULL,
  verification_source_url TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL,
  minimum_liquidity_raw NUMERIC(78,0) NOT NULL,
  liquidity_decimals INTEGER NOT NULL,
  maximum_staleness_seconds INTEGER NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  priority INTEGER NOT NULL,
  confidence_rules JSONB NOT NULL,
  route JSONB NOT NULL,
  methodology_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain_id, source_asset_address, quote_asset_address, source_key)
);

CREATE TABLE IF NOT EXISTS deterministic_price_observations (
  observation_key TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  token_address TEXT NOT NULL,
  quote_asset_address TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_contract_address TEXT,
  provider_name TEXT,
  pool_address TEXT,
  route JSONB NOT NULL,
  price_raw NUMERIC(78,0),
  price_decimals INTEGER NOT NULL,
  source_block_number BIGINT,
  source_block_hash TEXT,
  source_timestamp TIMESTAMPTZ NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  liquidity_depth_raw NUMERIC(78,0),
  liquidity_depth_decimals INTEGER,
  price_impact_bps NUMERIC(78,0),
  single_transaction_volume_bps NUMERIC(78,0),
  confidence_bps NUMERIC(78,0) NOT NULL,
  stale BOOLEAN NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('available', 'lowConfidence', 'unavailable')),
  authoritative BOOLEAN NOT NULL,
  reasons JSONB NOT NULL,
  canonical BOOLEAN NOT NULL DEFAULT true,
  methodology_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deterministic_price_observations_asset_time_idx
  ON deterministic_price_observations(chain_id, token_address, quote_asset_address, observed_at DESC);
CREATE INDEX IF NOT EXISTS deterministic_price_observations_source_time_idx
  ON deterministic_price_observations(source_key, observed_at DESC);
CREATE INDEX IF NOT EXISTS deterministic_price_observations_block_idx
  ON deterministic_price_observations(chain_id, source_block_number) WHERE source_block_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS market_candles (
  chain_id INTEGER NOT NULL,
  token_address TEXT NOT NULL,
  quote_asset_address TEXT NOT NULL,
  window TEXT NOT NULL CHECK (window IN ('1m', '5m', '15m', '1h', '6h', '24h', '7d', '30d')),
  bucket_start TIMESTAMPTZ NOT NULL,
  price_decimals INTEGER NOT NULL,
  open_price_raw NUMERIC(78,0) NOT NULL,
  high_price_raw NUMERIC(78,0) NOT NULL,
  low_price_raw NUMERIC(78,0) NOT NULL,
  close_price_raw NUMERIC(78,0) NOT NULL,
  source_observation_count NUMERIC(78,0) NOT NULL,
  canonical BOOLEAN NOT NULL DEFAULT true,
  methodology_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, token_address, quote_asset_address, window, bucket_start, methodology_version)
);

CREATE TABLE IF NOT EXISTS market_metrics (
  chain_id INTEGER NOT NULL,
  token_address TEXT NOT NULL,
  quote_asset_address TEXT NOT NULL,
  window TEXT NOT NULL CHECK (window IN ('1m', '5m', '15m', '1h', '6h', '24h', '7d', '30d')),
  bucket_start TIMESTAMPTZ NOT NULL,
  quote_decimals INTEGER NOT NULL,
  spot_price_raw NUMERIC(78,0),
  spot_price_decimals INTEGER,
  volume_raw NUMERIC(78,0) NOT NULL,
  buy_volume_raw NUMERIC(78,0) NOT NULL,
  sell_volume_raw NUMERIC(78,0) NOT NULL,
  buy_count NUMERIC(78,0) NOT NULL,
  sell_count NUMERIC(78,0) NOT NULL,
  unique_traders NUMERIC(78,0) NOT NULL,
  liquidity_raw NUMERIC(78,0),
  liquidity_decimals INTEGER,
  market_capitalization_raw NUMERIC(78,0),
  fully_diluted_valuation_raw NUMERIC(78,0),
  valuation_decimals INTEGER,
  circulating_supply_raw NUMERIC(78,0),
  circulating_supply_methodology TEXT,
  circulating_supply_exclusions JSONB NOT NULL,
  price_change_bps NUMERIC(78,0),
  volume_change_bps NUMERIC(78,0),
  liquidity_change_bps NUMERIC(78,0),
  holder_change NUMERIC(78,0),
  transaction_growth_bps NUMERIC(78,0),
  average_trade_size_raw NUMERIC(78,0),
  median_trade_size_raw NUMERIC(78,0),
  whale_volume_raw NUMERIC(78,0) NOT NULL,
  price_impact_by_order_size JSONB NOT NULL,
  canonical BOOLEAN NOT NULL DEFAULT true,
  methodology_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, token_address, quote_asset_address, window, bucket_start, methodology_version)
);

CREATE INDEX IF NOT EXISTS market_candles_asset_window_idx
  ON market_candles(chain_id, token_address, quote_asset_address, window, bucket_start DESC);
CREATE INDEX IF NOT EXISTS market_metrics_asset_window_idx
  ON market_metrics(chain_id, token_address, quote_asset_address, window, bucket_start DESC);
