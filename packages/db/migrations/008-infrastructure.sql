-- Hood Sentry Database Schema
-- Migration: 008 - Infrastructure Tables
-- Description: Add idempotency keys and leases tables for distributed coordination

-- Idempotency keys table for preventing duplicate operations
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  key VARCHAR(255) NOT NULL,
  namespace VARCHAR(100) NOT NULL,
  response_status VARCHAR(50) NOT NULL,
  response_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  UNIQUE(key, namespace)
);

-- Index for fast lookups by key and namespace
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_lookup 
  ON idempotency_keys(key, namespace);

-- Index for cleanup of expired keys
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires 
  ON idempotency_keys(expires_at) 
  WHERE expires_at IS NOT NULL;

-- Leases table for distributed locking
CREATE TABLE IF NOT EXISTS leases (
  key VARCHAR(255) PRIMARY KEY,
  owner_id VARCHAR(255) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Index for cleanup of expired leases
CREATE INDEX IF NOT EXISTS idx_leases_expires 
  ON leases(expires_at);

-- Index for owner lookups
CREATE INDEX IF NOT EXISTS idx_leases_owner 
  ON leases(owner_id);
