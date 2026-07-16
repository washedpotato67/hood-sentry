-- Migration: 021_notification_channel_verification
-- Created: 2026-07-15
-- Description: Add expiring one-time verification challenges for notification channels.

ALTER TABLE notification_channels
  ADD COLUMN IF NOT EXISTS verification_token_hash TEXT;

ALTER TABLE notification_channels
  ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMPTZ;

ALTER TABLE notification_channels
  ADD COLUMN IF NOT EXISTS verification_sent_at TIMESTAMPTZ;

ALTER TABLE notification_channels
  ADD COLUMN IF NOT EXISTS verification_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE notification_channels
  DROP CONSTRAINT IF EXISTS notification_channels_verification_attempts_check;

ALTER TABLE notification_channels
  ADD CONSTRAINT notification_channels_verification_attempts_check
  CHECK (verification_attempts >= 0 AND verification_attempts <= 10);
