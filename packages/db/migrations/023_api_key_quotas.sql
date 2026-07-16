-- Migration: 023_api_key_quotas
-- Created: 2026-07-15
-- Description: Add atomic minute and day usage buckets for scoped API keys.

ALTER TABLE api_keys
  ALTER COLUMN scopes SET DEFAULT '[]'::jsonb;

ALTER TABLE api_keys
  ALTER COLUMN scopes SET NOT NULL;

ALTER TABLE api_keys
  ADD CONSTRAINT api_keys_quota_per_minute_positive
  CHECK (quota_per_minute IS NULL OR quota_per_minute > 0);

ALTER TABLE api_keys
  ADD CONSTRAINT api_keys_quota_per_day_positive
  CHECK (quota_per_day IS NULL OR quota_per_day > 0);

CREATE UNIQUE INDEX IF NOT EXISTS api_keys_prefix_identity_idx
  ON api_keys(key_prefix);

CREATE TABLE IF NOT EXISTS api_key_usage_buckets (
  api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  period_kind TEXT NOT NULL CHECK (period_kind IN ('minute', 'day')),
  bucket_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (api_key_id, period_kind, bucket_start)
);

CREATE INDEX IF NOT EXISTS api_key_usage_buckets_expiry_idx
  ON api_key_usage_buckets(period_kind, bucket_start);
