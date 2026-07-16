-- Migration: 022_moderation_integrity
-- Created: 2026-07-15
-- Description: Enforce replay-safe claims and appeals with auditable moderation records.

ALTER TABLE project_claims
  ADD COLUMN IF NOT EXISTS review_notes TEXT;

ALTER TABLE report_appeals
  ADD COLUMN IF NOT EXISTS review_notes TEXT;

ALTER TABLE project_claims
  ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE community_reports
  ALTER COLUMN status SET DEFAULT 'submitted';

ALTER TABLE report_appeals
  ALTER COLUMN status SET DEFAULT 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS project_claims_intent_nonce_idx
  ON project_claims ((evidence->>'intentNonce'))
  WHERE evidence->>'intentNonce' IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS project_profile_versions_number_idx
  ON project_profile_versions(project_profile_id, version_number);

CREATE UNIQUE INDEX IF NOT EXISTS project_contracts_identity_idx
  ON project_contracts(project_profile_id, chain_id, contract_address);

CREATE UNIQUE INDEX IF NOT EXISTS report_appeals_pending_identity_idx
  ON report_appeals(report_id, appellant_address)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS admin_roles_active_identity_idx
  ON admin_roles(user_id, role_name)
  WHERE revoked_at IS NULL;
