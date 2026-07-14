-- Migration: 007_product
-- Created: 2026-07-13
-- Description: Product domain tables

-- Watchlists
CREATE TABLE IF NOT EXISTS watchlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (user_id, name)
);

CREATE INDEX idx_watchlists_user ON watchlists(user_id);
CREATE INDEX idx_watchlists_default ON watchlists(is_default) WHERE is_default = true;

-- Watchlist items
CREATE TABLE IF NOT EXISTS watchlist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id UUID NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  target_address TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('token', 'wallet', 'contract')),
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (watchlist_id, chain_id, target_address, target_type)
);

CREATE INDEX idx_watchlist_items_watchlist ON watchlist_items(watchlist_id);
CREATE INDEX idx_watchlist_items_chain_target ON watchlist_items(chain_id, target_address);

-- Alert rules
CREATE TABLE IF NOT EXISTS alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  target_address TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('price', 'volume', 'liquidity', 'transfer', 'approval', 'custom')),
  condition JSONB NOT NULL,
  channels JSONB NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_alert_rules_user ON alert_rules(user_id);
CREATE INDEX idx_alert_rules_chain_target ON alert_rules(chain_id, target_address);
CREATE INDEX idx_alert_rules_enabled ON alert_rules(enabled) WHERE enabled = true;

-- Alert events
CREATE TABLE IF NOT EXISTS alert_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  block_number BIGINT NOT NULL,
  transaction_hash TEXT,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  metadata JSONB NOT NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alert_events_rule ON alert_events(alert_rule_id);
CREATE INDEX idx_alert_events_chain ON alert_events(chain_id);
CREATE INDEX idx_alert_events_triggered ON alert_events(triggered_at);
CREATE INDEX idx_alert_events_resolved ON alert_events(resolved_at) WHERE resolved_at IS NULL;

-- Notification channels
CREATE TABLE IF NOT EXISTS notification_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('email', 'telegram', 'webhook', 'push')),
  channel_config JSONB NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT false,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_channels_user ON notification_channels(user_id);
CREATE INDEX idx_notification_channels_type ON notification_channels(channel_type);
CREATE INDEX idx_notification_channels_verified ON notification_channels(verified) WHERE verified = true;

-- Notification deliveries
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_channel_id UUID NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  alert_event_id UUID NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'delivered')),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_deliveries_channel ON notification_deliveries(notification_channel_id);
CREATE INDEX idx_notification_deliveries_event ON notification_deliveries(alert_event_id);
CREATE INDEX idx_notification_deliveries_status ON notification_deliveries(status);

-- Webhook endpoints
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  events JSONB NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_endpoints_user ON webhook_endpoints(user_id);
CREATE INDEX idx_webhook_endpoints_enabled ON webhook_endpoints(enabled) WHERE enabled = true;

-- Webhook deliveries
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'delivered')),
  response_status INTEGER,
  response_body TEXT,
  delivered_at TIMESTAMPTZ,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_deliveries_endpoint ON webhook_deliveries(webhook_endpoint_id);
CREATE INDEX idx_webhook_deliveries_status ON webhook_deliveries(status);
CREATE INDEX idx_webhook_deliveries_created ON webhook_deliveries(created_at);

-- Project profiles
CREATE TABLE IF NOT EXISTS project_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  project_name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  website_url TEXT,
  logo_uri TEXT,
  verified BOOLEAN NOT NULL DEFAULT false,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_project_profiles_chain ON project_profiles(chain_id);
CREATE INDEX idx_project_profiles_verified ON project_profiles(verified) WHERE verified = true;

-- Project profile versions
CREATE TABLE IF NOT EXISTS project_profile_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_profile_id UUID NOT NULL REFERENCES project_profiles(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  changes JSONB NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_profile_id, version_number)
);

CREATE INDEX idx_project_profile_versions_project ON project_profile_versions(project_profile_id);

-- Project contracts
CREATE TABLE IF NOT EXISTS project_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_profile_id UUID NOT NULL REFERENCES project_profiles(id) ON DELETE CASCADE,
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  contract_address TEXT NOT NULL,
  contract_type TEXT NOT NULL CHECK (contract_type IN ('token', 'staking', 'governance', 'treasury', 'other')),
  verified BOOLEAN NOT NULL DEFAULT false,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_profile_id, chain_id, contract_address)
);

CREATE INDEX idx_project_contracts_project ON project_contracts(project_profile_id);
CREATE INDEX idx_project_contracts_chain_address ON project_contracts(chain_id, contract_address);

-- Project claims
CREATE TABLE IF NOT EXISTS project_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_profile_id UUID NOT NULL REFERENCES project_profiles(id) ON DELETE CASCADE,
  claimer_address TEXT NOT NULL,
  claim_type TEXT NOT NULL CHECK (claim_type IN ('ownership', 'team', 'partner')),
  evidence JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_project_claims_project ON project_claims(project_profile_id);
CREATE INDEX idx_project_claims_status ON project_claims(status);

-- Community reports
CREATE TABLE IF NOT EXISTS community_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  target_address TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('token', 'wallet', 'contract', 'project')),
  reporter_address TEXT NOT NULL,
  report_type TEXT NOT NULL CHECK (report_type IN ('scam', 'phishing', 'rug_pull', 'hack', 'spam', 'other')),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  description TEXT NOT NULL,
  evidence_urls JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('submitted', 'under_review', 'upheld', 'rejected', 'appealed')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_community_reports_chain_target ON community_reports(chain_id, target_address);
CREATE INDEX idx_community_reports_reporter ON community_reports(reporter_address);
CREATE INDEX idx_community_reports_status ON community_reports(status);
CREATE INDEX idx_community_reports_submitted ON community_reports(submitted_at);

-- Report evidence
CREATE TABLE IF NOT EXISTS report_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES community_reports(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('url', 'image', 'document', 'transaction', 'other')),
  evidence_data JSONB NOT NULL,
  submitted_by TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_report_evidence_report ON report_evidence(report_id);
CREATE INDEX idx_report_evidence_type ON report_evidence(evidence_type);

-- Report resolutions
CREATE TABLE IF NOT EXISTS report_resolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES community_reports(id) ON DELETE CASCADE,
  resolution_type TEXT NOT NULL CHECK (resolution_type IN ('upheld', 'rejected', 'partial')),
  resolution_notes TEXT NOT NULL,
  resolved_by TEXT NOT NULL,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_report_resolutions_report ON report_resolutions(report_id);

-- Report appeals
CREATE TABLE IF NOT EXISTS report_appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES community_reports(id) ON DELETE CASCADE,
  appellant_address TEXT NOT NULL,
  appeal_reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_report_appeals_report ON report_appeals(report_id);
CREATE INDEX idx_report_appeals_status ON report_appeals(status);

-- Transaction intents
CREATE TABLE IF NOT EXISTS transaction_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chain_id INTEGER NOT NULL REFERENCES chains(chain_id),
  intent_type TEXT NOT NULL CHECK (intent_type IN ('transfer', 'swap', 'approve', 'stake', 'unstake', 'claim', 'custom')),
  target_address TEXT NOT NULL,
  calldata TEXT NOT NULL,
  value_raw NUMERIC(78,0) NOT NULL DEFAULT 0,
  deadline TIMESTAMPTZ NOT NULL,
  simulation_result JSONB NOT NULL,
  warnings JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'simulated', 'signed', 'broadcasted', 'confirmed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_at TIMESTAMPTZ,
  tx_hash TEXT
);

CREATE INDEX idx_transaction_intents_user ON transaction_intents(user_id);
CREATE INDEX idx_transaction_intents_chain ON transaction_intents(chain_id);
CREATE INDEX idx_transaction_intents_status ON transaction_intents(status);
CREATE INDEX idx_transaction_intents_created ON transaction_intents(created_at);

-- Feature flags
CREATE TABLE IF NOT EXISTS feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_name TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feature_flags_enabled ON feature_flags(enabled) WHERE enabled = true;

-- Admin roles
CREATE TABLE IF NOT EXISTS admin_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_name TEXT NOT NULL CHECK (role_name IN ('super_admin', 'admin', 'moderator', 'analyst')),
  granted_by TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, role_name)
);

CREATE INDEX idx_admin_roles_user ON admin_roles(user_id);
CREATE INDEX idx_admin_roles_role ON admin_roles(role_name);
CREATE INDEX idx_admin_roles_active ON admin_roles(revoked_at) WHERE revoked_at IS NULL;

-- Admin audit logs
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('create', 'update', 'delete', 'approve', 'reject', 'suspend', 'restore')),
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  changes JSONB NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admin_audit_logs_admin ON admin_audit_logs(admin_user_id);
CREATE INDEX idx_admin_audit_logs_action ON admin_audit_logs(action_type);
CREATE INDEX idx_admin_audit_logs_target ON admin_audit_logs(target_type, target_id);
CREATE INDEX idx_admin_audit_logs_performed ON admin_audit_logs(performed_at);
