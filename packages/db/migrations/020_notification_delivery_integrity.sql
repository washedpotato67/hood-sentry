-- Migration: 020_notification_delivery_integrity
-- Created: 2026-07-15
-- Description: Add provider delivery provenance and webhook idempotency.

ALTER TABLE alert_events
  ADD COLUMN IF NOT EXISTS block_hash TEXT;

ALTER TABLE alert_events
  ADD COLUMN IF NOT EXISTS log_index INTEGER;

DROP INDEX IF EXISTS alert_events_source_event_idx;

CREATE UNIQUE INDEX IF NOT EXISTS alert_events_source_log_idx
  ON alert_events(
    alert_rule_id,
    chain_id,
    block_hash,
    COALESCE(transaction_hash, ''),
    COALESCE(log_index, -1)
  )
  WHERE block_hash IS NOT NULL;

ALTER TABLE notification_deliveries
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

ALTER TABLE notification_deliveries
  ADD COLUMN IF NOT EXISTS response_status INTEGER;

ALTER TABLE notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_response_status_check;

ALTER TABLE notification_deliveries
  ADD CONSTRAINT notification_deliveries_response_status_check
  CHECK (response_status IS NULL OR (response_status >= 100 AND response_status <= 599));

ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

UPDATE webhook_deliveries
SET idempotency_key = id::text
WHERE idempotency_key IS NULL;

ALTER TABLE webhook_deliveries
  ALTER COLUMN idempotency_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS webhook_deliveries_idempotency_idx
  ON webhook_deliveries(idempotency_key);

ALTER TABLE webhook_deliveries
  DROP CONSTRAINT IF EXISTS webhook_deliveries_status_check;

ALTER TABLE webhook_deliveries
  ADD CONSTRAINT webhook_deliveries_status_check
  CHECK (status IN ('pending', 'sent', 'failed', 'delivered'));

ALTER TABLE webhook_deliveries
  DROP CONSTRAINT IF EXISTS webhook_deliveries_response_body_size_check;

ALTER TABLE webhook_deliveries
  ADD CONSTRAINT webhook_deliveries_response_body_size_check
  CHECK (response_body IS NULL OR octet_length(response_body) <= 4096);
