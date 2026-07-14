-- Migration: 013_deterministic_risk_engine
-- Created: 2026-07-14
-- Description: Deterministic risk scans, versioned rulesets, triggers, cancellation, and reorg state

ALTER TABLE risk_scan_runs
  ADD COLUMN IF NOT EXISTS target_type TEXT NOT NULL DEFAULT 'token',
  ADD COLUMN IF NOT EXISTS methodology_version TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS source_block_hash TEXT,
  ADD COLUMN IF NOT EXISTS trigger_type TEXT NOT NULL DEFAULT 'manual_analyst_request',
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS canonical BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS partial BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancellation_requested_at TIMESTAMPTZ;

ALTER TABLE risk_scan_runs DROP CONSTRAINT IF EXISTS risk_scan_runs_status_check;
ALTER TABLE risk_scan_runs
  ADD CONSTRAINT risk_scan_runs_status_check
  CHECK (status IN ('pending', 'running', 'completed', 'partial', 'failed', 'cancelled'));
ALTER TABLE risk_scan_runs
  ADD CONSTRAINT risk_scan_runs_target_type_check
  CHECK (target_type IN ('token', 'pool', 'wallet', 'project', 'launchpad_token'));
ALTER TABLE risk_scan_runs
  ADD CONSTRAINT risk_scan_runs_trigger_type_check
  CHECK (trigger_type IN (
    'new_token',
    'source_verification',
    'proxy_implementation_change',
    'ownership_change',
    'role_change',
    'mint',
    'supply_change',
    'pool_creation',
    'liquidity_removal',
    'holder_concentration_change',
    'launchpad_graduation',
    'launchpad_migration',
    'token_code_change',
    'manual_analyst_request',
    'methodology_version_change'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS idx_risk_scan_runs_idempotency
  ON risk_scan_runs(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_risk_scan_runs_canonical_source
  ON risk_scan_runs(chain_id, canonical, source_block);

ALTER TABLE risk_findings
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS confidence_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS source_block BIGINT,
  ADD COLUMN IF NOT EXISTS source_block_hash TEXT;

ALTER TABLE risk_findings
  ADD CONSTRAINT risk_findings_status_check
  CHECK (status IN ('pass', 'warning', 'fail', 'unknown', 'not_applicable'));

UPDATE risk_findings finding
SET
  source_block = scan.source_block,
  source_block_hash = scan.source_block_hash
FROM risk_scan_runs scan
WHERE finding.scan_run_id = scan.id
  AND finding.source_block IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_risk_findings_scan_fingerprint
  ON risk_findings(scan_run_id, fingerprint);

ALTER TABLE risk_scores
  ADD COLUMN IF NOT EXISTS completeness_detail JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS idx_risk_scores_one_per_scan ON risk_scores(scan_run_id);

ALTER TABLE risk_suppressions
  ADD COLUMN IF NOT EXISTS rule_version TEXT,
  ADD COLUMN IF NOT EXISTS fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_by TEXT,
  ADD COLUMN IF NOT EXISTS revocation_reason TEXT;

ALTER TABLE risk_suppressions
  ALTER COLUMN rule_id DROP NOT NULL;

ALTER TABLE risk_suppressions
  ADD CONSTRAINT risk_suppressions_selector_check
  CHECK (rule_id IS NOT NULL OR fingerprint IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_risk_suppressions_fingerprint
  ON risk_suppressions(fingerprint)
  WHERE fingerprint IS NOT NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS risk_ruleset_versions (
  version TEXT PRIMARY KEY,
  methodology_version TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  rule_references JSONB NOT NULL,
  category_penalty_caps_bps JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS risk_rescan_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  target_type TEXT NOT NULL,
  target_address TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  source_block BIGINT NOT NULL,
  source_block_hash TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  methodology_version TEXT NOT NULL,
  event_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued',
  scan_run_id UUID REFERENCES risk_scan_runs(id),
  canonical BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT risk_rescan_requests_target_type_check
    CHECK (target_type IN ('token', 'pool', 'wallet', 'project', 'launchpad_token')),
  CONSTRAINT risk_rescan_requests_trigger_type_check
    CHECK (trigger_type IN (
      'new_token',
      'source_verification',
      'proxy_implementation_change',
      'ownership_change',
      'role_change',
      'mint',
      'supply_change',
      'pool_creation',
      'liquidity_removal',
      'holder_concentration_change',
      'launchpad_graduation',
      'launchpad_migration',
      'token_code_change',
      'manual_analyst_request',
      'methodology_version_change'
    )),
  CONSTRAINT risk_rescan_requests_status_check
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'orphaned'))
);

CREATE INDEX IF NOT EXISTS idx_risk_rescan_requests_target
  ON risk_rescan_requests(chain_id, target_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_rescan_requests_status
  ON risk_rescan_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_risk_rescan_requests_source
  ON risk_rescan_requests(chain_id, canonical, source_block);

COMMENT ON COLUMN risk_scan_runs.source_block_hash IS
  'Pinned block hash. NULL only for scan history created before migration 013.';
COMMENT ON COLUMN risk_findings.source_block_hash IS
  'Pinned block hash. NULL only for finding history created before migration 013.';
