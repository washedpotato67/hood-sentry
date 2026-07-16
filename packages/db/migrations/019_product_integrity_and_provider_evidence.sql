-- Migration: 019_product_integrity_and_provider_evidence
-- Created: 2026-07-15
-- Description: Add product idempotency rules and bounded provider evidence storage.

CREATE UNIQUE INDEX IF NOT EXISTS project_claims_active_identity_idx
  ON project_claims(project_profile_id, claimer_address, claim_type)
  WHERE status IN ('pending', 'approved');

CREATE UNIQUE INDEX IF NOT EXISTS alert_events_source_event_idx
  ON alert_events(
    alert_rule_id,
    chain_id,
    block_number,
    COALESCE(transaction_hash, '')
  );

CREATE UNIQUE INDEX IF NOT EXISTS notification_deliveries_channel_event_idx
  ON notification_deliveries(notification_channel_id, alert_event_id);

ALTER TABLE webhook_endpoints
  ADD COLUMN IF NOT EXISTS secret_version INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'webhook_endpoints_secret_version_positive'
  ) THEN
    ALTER TABLE webhook_endpoints
      ADD CONSTRAINT webhook_endpoints_secret_version_positive
      CHECK (secret_version > 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS provider_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  trust_class TEXT NOT NULL,
  chain_id INTEGER,
  request_fingerprint TEXT NOT NULL,
  response_hash TEXT NOT NULL,
  response_payload JSONB NOT NULL,
  response_bytes INTEGER NOT NULL CHECK (response_bytes >= 0 AND response_bytes <= 1000000),
  http_status INTEGER NOT NULL CHECK (http_status >= 100 AND http_status <= 599),
  fetched_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  source_block_number BIGINT,
  source_block_hash TEXT,
  canonical BOOLEAN NOT NULL DEFAULT true,
  registry_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider_id, capability, request_fingerprint, response_hash)
);

CREATE INDEX IF NOT EXISTS provider_evidence_provider_time_idx
  ON provider_evidence(provider_id, capability, fetched_at DESC);

CREATE INDEX IF NOT EXISTS provider_evidence_chain_block_idx
  ON provider_evidence(chain_id, source_block_number)
  WHERE chain_id IS NOT NULL;
