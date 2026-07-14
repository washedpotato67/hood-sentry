CREATE TABLE IF NOT EXISTS discovery_snapshots (
  chain_id INTEGER NOT NULL,
  token_address TEXT NOT NULL,
  methodology_version TEXT NOT NULL,
  source_block_number BIGINT NOT NULL,
  source_block_hash TEXT NOT NULL,
  score_bps NUMERIC(78,0) NOT NULL,
  confidence_bps NUMERIC(78,0) NOT NULL,
  payload TEXT NOT NULL,
  canonical BOOLEAN NOT NULL DEFAULT true,
  observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, token_address, methodology_version, source_block_number)
);

CREATE INDEX IF NOT EXISTS discovery_snapshots_rank_idx
  ON discovery_snapshots(chain_id, methodology_version, canonical, score_bps DESC);
CREATE INDEX IF NOT EXISTS discovery_snapshots_block_idx
  ON discovery_snapshots(chain_id, source_block_number);

CREATE TABLE IF NOT EXISTS discovery_current (
  chain_id INTEGER NOT NULL,
  token_address TEXT NOT NULL,
  methodology_version TEXT NOT NULL,
  source_block_number BIGINT NOT NULL,
  source_block_hash TEXT NOT NULL,
  score_bps NUMERIC(78,0) NOT NULL,
  confidence_bps NUMERIC(78,0) NOT NULL,
  payload TEXT NOT NULL,
  canonical BOOLEAN NOT NULL DEFAULT true,
  observed_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, token_address, methodology_version)
);

CREATE INDEX IF NOT EXISTS discovery_current_rank_idx
  ON discovery_current(chain_id, methodology_version, canonical, score_bps DESC);

CREATE TABLE IF NOT EXISTS sponsored_placements (
  placement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id INTEGER NOT NULL,
  token_address TEXT NOT NULL,
  feed TEXT NOT NULL,
  priority INTEGER NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  label TEXT NOT NULL DEFAULT 'Sponsored' CHECK (label = 'Sponsored'),
  disclosure TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS sponsored_placements_active_idx
  ON sponsored_placements(chain_id, feed, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS sponsored_placement_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  placement_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'disabled', 'expired')),
  actor_id TEXT NOT NULL,
  before_payload TEXT,
  after_payload TEXT,
  reason TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sponsored_placement_audit_placement_idx
  ON sponsored_placement_audit(placement_id, recorded_at DESC);
