-- Seeds the supported Robinhood Chain networks.
-- Every chain-scoped table carries a chain_id foreign key to chains, so an empty
-- chains table makes the indexer and worker fail on their first write. These are
-- static chain facts, not operator configuration, so they belong with the schema.
-- Block heights stay NULL: the indexer owns those and fills them as it syncs.

INSERT INTO chains (chain_id, name, native_symbol, enabled)
VALUES
  (4663, 'Robinhood Chain', 'ETH', true),
  (46630, 'Robinhood Chain Testnet', 'ETH', true)
ON CONFLICT (chain_id) DO NOTHING;
