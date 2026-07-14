-- Migration: 004_risk
-- Created: 2026-07-13
-- Description: Risk domain tables

-- Risk scan runs
CREATE TABLE IF NOT EXISTS risk_scan_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  target_address TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  source_block BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_risk_scan_runs_chain_target ON risk_scan_runs(chain_id, target_address);
CREATE INDEX idx_risk_scan_runs_chain_status ON risk_scan_runs(chain_id, status);
CREATE INDEX idx_risk_scan_runs_started ON risk_scan_runs(started_at);

-- Risk findings
CREATE TABLE IF NOT EXISTS risk_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_run_id UUID NOT NULL REFERENCES risk_scan_runs(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
  confidence NUMERIC(3,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  title TEXT NOT NULL,
  explanation TEXT NOT NULL,
  evidence JSONB NOT NULL,
  remediation TEXT,
  source_provenance JSONB NOT NULL,
  fingerprint TEXT NOT NULL,
  suppressed BOOLEAN NOT NULL DEFAULT false,
  suppression_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_risk_findings_scan_run ON risk_findings(scan_run_id);
CREATE INDEX idx_risk_findings_severity ON risk_findings(severity);
CREATE INDEX idx_risk_findings_category ON risk_findings(category);
CREATE INDEX idx_risk_findings_fingerprint ON risk_findings(fingerprint);
CREATE INDEX idx_risk_findings_suppressed ON risk_findings(suppressed) WHERE suppressed = false;

-- Risk scores
CREATE TABLE IF NOT EXISTS risk_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_run_id UUID NOT NULL REFERENCES risk_scan_runs(id) ON DELETE CASCADE,
  score NUMERIC(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
  grade TEXT NOT NULL CHECK (grade IN ('A', 'B', 'C', 'D', 'F')),
  category_scores JSONB NOT NULL,
  methodology_version TEXT NOT NULL,
  completeness_percent NUMERIC(5,2) NOT NULL CHECK (completeness_percent >= 0 AND completeness_percent <= 100),
  unresolved_data_warnings JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_risk_scores_scan_run ON risk_scores(scan_run_id);
CREATE INDEX idx_risk_scores_grade ON risk_scores(grade);

-- Risk rule versions
CREATE TABLE IF NOT EXISTS risk_rule_versions (
  rule_id TEXT NOT NULL,
  version TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  weight NUMERIC(5,2) NOT NULL,
  max_penalty NUMERIC(5,2) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (rule_id, version)
);

CREATE INDEX idx_risk_rule_versions_category ON risk_rule_versions(category);
CREATE INDEX idx_risk_rule_versions_enabled ON risk_rule_versions(enabled) WHERE enabled = true;

-- Risk suppressions
CREATE TABLE IF NOT EXISTS risk_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  target_address TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  suppressed_by TEXT NOT NULL,
  suppressed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_risk_suppressions_chain_target ON risk_suppressions(chain_id, target_address);
CREATE INDEX idx_risk_suppressions_expires ON risk_suppressions(expires_at);

-- Malicious address labels
CREATE TABLE IF NOT EXISTS malicious_address_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  address TEXT NOT NULL,
  label_type TEXT NOT NULL CHECK (label_type IN ('scam', 'phishing', 'hack', 'sanctioned', 'spam', 'other')),
  label_source TEXT NOT NULL,
  confidence NUMERIC(3,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence JSONB NOT NULL,
  labeled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, address, label_type, label_source)
);

CREATE INDEX idx_malicious_address_labels_chain_address ON malicious_address_labels(chain_id, address);
CREATE INDEX idx_malicious_address_labels_chain_type ON malicious_address_labels(chain_id, label_type);
CREATE INDEX idx_malicious_address_labels_labeled ON malicious_address_labels(labeled_at);
