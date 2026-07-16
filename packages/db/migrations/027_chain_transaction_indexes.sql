ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transaction_index INTEGER;

ALTER TABLE logs
  ADD COLUMN IF NOT EXISTS transaction_index INTEGER;

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_transaction_index_nonnegative;

ALTER TABLE transactions
  ADD CONSTRAINT transactions_transaction_index_nonnegative
  CHECK (transaction_index IS NULL OR transaction_index >= 0);

ALTER TABLE logs
  DROP CONSTRAINT IF EXISTS logs_transaction_index_nonnegative;

ALTER TABLE logs
  ADD CONSTRAINT logs_transaction_index_nonnegative
  CHECK (transaction_index IS NULL OR transaction_index >= 0);

CREATE INDEX IF NOT EXISTS transactions_chain_block_position_idx
  ON transactions (chain_id, block_number, transaction_index);

CREATE INDEX IF NOT EXISTS logs_chain_block_transaction_position_idx
  ON logs (chain_id, block_number, transaction_index, log_index);
