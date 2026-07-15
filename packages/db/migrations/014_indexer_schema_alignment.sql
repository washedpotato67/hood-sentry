-- Migration: 014_indexer_schema_alignment
-- Created: 2026-07-15
-- Description: Align the chain-fact tables with the values the indexer actually
-- writes, and make an indexer lease exclusive per stream.

-- The indexer classifies blocks as pending/soft_confirmed/safe/finalized and marks
-- reorged blocks orphaned. The original check only allowed 'confirmed', which no
-- code path emits, so every block outside 'pending'/'finalized' was rejected.
ALTER TABLE blocks DROP CONSTRAINT IF EXISTS blocks_finality_state_check;
ALTER TABLE blocks ADD CONSTRAINT blocks_finality_state_check
  CHECK (finality_state IN ('pending', 'soft_confirmed', 'safe', 'finalized', 'orphaned'));

-- Transaction and receipt status are integers everywhere in code (1 success, 0 failed),
-- matching the RPC receipt encoding. The tables declared them as text.
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_status_check;
ALTER TABLE transactions
  ALTER COLUMN status TYPE INTEGER
  USING (CASE status WHEN 'success' THEN 1 ELSE 0 END);
ALTER TABLE transactions ADD CONSTRAINT transactions_status_check
  CHECK (status IN (0, 1));

ALTER TABLE transaction_receipts DROP CONSTRAINT IF EXISTS transaction_receipts_status_check;
ALTER TABLE transaction_receipts
  ALTER COLUMN status TYPE INTEGER
  USING (CASE status WHEN 'success' THEN 1 ELSE 0 END);
ALTER TABLE transaction_receipts ADD CONSTRAINT transaction_receipts_status_check
  CHECK (status IN (0, 1));

-- The indexer treats a lease as a mutual-exclusion token for a stream, but worker_id
-- was part of the primary key, so every worker could insert its own lease row and
-- index the same stream concurrently. One lease per (chain, stream).
DELETE FROM indexer_leases a
  USING indexer_leases b
  WHERE a.chain_id = b.chain_id
    AND a.stream = b.stream
    AND a.ctid < b.ctid;

ALTER TABLE indexer_leases DROP CONSTRAINT indexer_leases_pkey;
ALTER TABLE indexer_leases ADD PRIMARY KEY (chain_id, stream);
