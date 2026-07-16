-- Adds oracle heartbeat, sequencer feed linkage, and observed oracle round state
-- to support Chainlink price feed verification before price-dependent features.

ALTER TABLE price_source_configs
  ADD COLUMN IF NOT EXISTS oracle_heartbeat_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS sequencer_feed_address TEXT;

ALTER TABLE deterministic_price_observations
  ADD COLUMN IF NOT EXISTS round_id NUMERIC(78,0),
  ADD COLUMN IF NOT EXISTS answered_in_round NUMERIC(78,0),
  ADD COLUMN IF NOT EXISTS oracle_paused BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sequencer_up BOOLEAN,
  ADD COLUMN IF NOT EXISTS sequencer_recovered_at TIMESTAMPTZ;
