-- Migration: 015_token_approval_ordering
-- Created: 2026-07-15
-- Description: Give token_approvals a total order so approval state is
-- independent of job arrival order.

-- token_approvals holds last-write-wins allowance state. Derived jobs are delivered
-- at least once and processed concurrently, so an older approval can arrive after a
-- newer one. last_updated_block alone cannot order two approvals inside one block;
-- (block, log_index) is the total order of the emitting logs.
ALTER TABLE token_approvals
  ADD COLUMN IF NOT EXISTS last_updated_log_index INTEGER NOT NULL DEFAULT 0;
