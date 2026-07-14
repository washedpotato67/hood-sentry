# Data Model

Use PostgreSQL. Token quantities and prices use `numeric(78,0)` integer representations with explicit decimal metadata, or byte-safe bigint mappings. Never use database `float` for financial values.

## Chain ingestion

### `chains`
- `id`
- `chain_id`
- `name`
- `native_symbol`
- `enabled`
- `head_block_number`
- `finalized_block_number`
- timestamps

### `blocks`
- `chain_id`
- `number`
- `hash`
- `parent_hash`
- `timestamp`
- `finality_state`
- `canonical`
- unique `(chain_id, number, hash)`

### `transactions`
- `chain_id`
- `hash`
- `block_number`
- `block_hash`
- `from_address`
- `to_address`
- `nonce`
- `value_raw`
- `input`
- `status`
- `gas_used`
- `effective_gas_price`
- `contract_created`
- `canonical`

### `logs`
- `chain_id`
- `block_number`
- `block_hash`
- `transaction_hash`
- `transaction_index`
- `log_index`
- `address`
- `topic0..topic3`
- `data`
- `removed`
- `canonical`
- unique `(chain_id, transaction_hash, log_index, block_hash)`

### `indexer_checkpoints`
- `chain_id`
- `stream`
- `next_block`
- `last_block_hash`
- `locked_by`
- `updated_at`

## Contracts and tokens

Explorer enrichment lives in `explorer_contract_metadata`, separate from the `contracts` chain-fact
record. Each row includes its provider URL, provider endpoints, fetch time, expiry time, source hash,
raw bounded response, and normalized metadata. `data_quality_warnings` stores explorer and chain
values when proxy implementation or admin claims disagree. Current implementation and admin values
always come from direct chain reads.

### `contracts`
- `chain_id`
- `address`
- `creator_address`
- `creation_tx_hash`
- `creation_block`
- `bytecode_hash`
- `runtime_bytecode`
- `is_proxy`
- `proxy_type`
- `implementation_address`
- `proxy_admin_address`
- `verified`
- `source_provider`
- `source_fetched_at`
- `abi_json`
- `compiler_metadata`
- timestamps

### `tokens`
- `chain_id`
- `address`
- `name`
- `symbol`
- `decimals`
- `total_supply_raw`
- `token_type`
- `canonical_asset_key`
- `logo_uri`
- `metadata_status`
- `spam_status`
- `first_seen_block`
- timestamps

### `token_transfers`
- chain provenance columns
- `token_address`
- `from_address`
- `to_address`
- `amount_raw`
- `ui_amount_raw` nullable
- indexes by token, from, to, block

### `token_balances`
- `chain_id`
- `token_address`
- `wallet_address`
- `balance_raw`
- `as_of_block`
- primary key `(chain_id, token_address, wallet_address)`

### `holder_snapshots`
- `token_address`
- `snapshot_block`
- `holder_count`
- `top_10_bps`
- `top_20_bps`
- `gini_scaled`
- `circulating_supply_raw`
- classification exclusions and methodology version

## DEX and pricing

### `dex_protocols`
- protocol key and version
- protocol kind, registry version, and enabled state
- latest validation status, validation time, and cache expiry
- factory, router, and quoter summaries where applicable

Disabled registry entries remain visible for operational review. Only entries with successful
direct runtime verification produce an active adapter.

### `protocol_contracts`
- contract role and checksummed registry address
- official source and explorer URL
- independent verification date
- expected runtime bytecode hash
- expected proxy type, implementation, and admin where applicable
- enabled state

### `protocol_contract_verifications`
- observed runtime bytecode hash
- observed proxy implementation and admin
- valid state and failure code
- errors, check time, and cache expiry

### `pools`
- `chain_id`
- `address`
- `protocol`
- `protocol_version`
- `factory_address`
- `token0`
- `token1`
- `fee_tier`
- pool type and tick spacing where applicable
- `created_block`
- `created_block_hash`
- `created_tx_hash`
- creation log index
- canonical state
- `active`
- normalized integer state with its source block

### `pool_tokens`
- chain ID, pool address, and token address identity
- raw reserve and optional weight

### `swaps`
- chain provenance columns
- `pool_address`
- `sender`
- `recipient`
- normalized direction, amount in, and amount out
- raw fee when emitted or derived by the adapter
- protocol version and canonical state

### `liquidity_events`
- add, remove, LP mint, LP burn, position, fee collection, curve, and migration classifications
- provider, owner, recipient, pool, and token addresses
- raw token amounts, optional position ID, and optional tick range
- chain provenance, protocol version, and canonical state

### `protocol_quotes`
- quote ID, protocol version, route, and source block
- raw input, expected output, and minimum output
- target, selector, spender, warnings, and expiry

### Launchpad event tables

`launchpad_tokens`, `launchpad_trades`, `launchpad_creator_fee_events`, `launchpad_graduations`, and
`launchpad_migrations` preserve token creation, creator, implementation, supply, bonding curve, buy
or sell direction, raw trade and fee values, graduation threshold, migration contract, destination
protocol, destination pool, protocol version, and full chain provenance.

### `price_source_configs`
- source key and source type
- asset class, chain ID, source asset address, and quote asset address
- source contract address where applicable
- verification URL and verification date
- minimum raw liquidity and decimal scale
- maximum staleness, priority, enabled state, confidence rules, and route
- methodology version

### `deterministic_price_observations`
- token and quote asset contract addresses
- source key, type, contract, provider, pool, and route
- nullable raw price and explicit decimal scale
- source block number, block hash, source time, and observation time
- liquidity depth, price impact, and single-transaction concentration
- confidence basis points, stale state, status, reason codes, and authoritative state
- canonical state and methodology version

### `market_candles`
- token and quote asset contract addresses
- window and bucket start
- raw integer OHLC values and price decimal scale
- source observation count
- canonical state and methodology version

### `market_metrics`
- spot price and decimal scale
- raw buy, sell, total, whale, average, and median volumes
- buy, sell, trader, holder, and transaction measures
- liquidity and standard-size price impacts
- nullable market capitalization and separate nullable fully diluted valuation
- circulating supply, methodology, and exclusions
- canonical state and methodology version

### `token_metrics_1m`, `token_metrics_1h`, `token_metrics_1d`
- OHLC integer prices
- volume
- buys/sells
- unique traders
- liquidity
- market cap/FDV where valid
- holder count and growth

### `price_observations`
- asset key
- source
- price raw
- decimals
- observed at
- source timestamp
- stale flag
- confidence/status
- chain provenance when onchain

## Risk

### `risk_scan_runs`
- `id`
- target type, chain, and address
- engine version
- ruleset version
- methodology version
- source block and block hash
- trigger and idempotency key
- canonical and partial state
- pending, running, completed, partial, failed, or cancelled status
- cancellation request time
- started/completed
- error code

### `risk_findings`
- scan ID
- rule ID/version
- pass, warning, fail, unknown, or not-applicable status
- category
- severity
- confidence
- confidence level, basis points, and rationale
- title
- explanation
- evidence JSON
- remediation
- source provenance
- source block and block hash
- fingerprint
- suppressed status plus reason

### `risk_scores`
- scan ID
- score 0–100
- grade
- category subscores
- methodology version
- completeness percentage
- unresolved-data warnings
- structured completeness detail

### `risk_rule_versions`
- immutable rule ID and version
- category and description
- integer-safe weight and maximum penalty configuration
- enabled state

### `risk_ruleset_versions`
- immutable ruleset version
- methodology and engine versions
- exact rule references
- category penalty caps in basis points

### `risk_rescan_requests`
- target type, chain, and address
- trigger type and source event ID
- source block and block hash
- ruleset and methodology versions
- requester and idempotency key
- queue status, linked scan, and canonical state

### `risk_suppressions`
- target chain and address
- rule ID/version or stable finding fingerprint
- reason and analyst identity
- creation, expiration, and revocation state

## Wallet and portfolio

### `wallets`
- chain/address
- first seen
- user-owned flag
- labels

### `wallet_token_lots`
- wallet/token
- acquisition transaction
- amount raw
- unit cost integer + decimals
- remaining amount
- methodology

### `wallet_pnl_snapshots`
- wallet/token/time
- balance
- cost basis
- realized P&L
- unrealized P&L
- confidence

### `allowances`
- owner/token/spender
- allowance raw
- last updated block
- spender classification
- risk status

## Users and auth

### `users`
- id, status, created/updated

### `user_wallets`
- user ID, chain ID, address, verified timestamp, primary flag

### `siwe_nonces`
- hashed nonce, domain, expiration, consumed timestamp

### `sessions`
- hashed session token, user ID, expiry, device metadata, revoked

### `api_keys`
- prefix, secret hash, owner, scopes, quota, last used, revoked

## Product data

### `watchlists`, `watchlist_items`
### `alert_rules`
### `alert_events`
### `notification_deliveries`
### `webhook_endpoints`
### `webhook_deliveries`
### `project_profiles`
### `project_contracts`
### `project_claims`
### `project_profile_versions`
### `community_reports`
### `report_evidence`
### `report_resolutions`
### `contract_action_intents`
### `admin_audit_logs`
### `feature_flags`

## Discovery analytics

### `discovery_snapshots`

- chain ID and token address
- methodology version
- source block number and hash
- organic score and confidence in basis points
- serialized public item with every component and manipulation evidence
- canonical status and observation time

The primary key makes refresh jobs idempotent by chain, token, methodology, and source block.

### `discovery_current`

- latest canonical projection per chain, token, and methodology
- source block provenance
- organic score and confidence
- complete public payload

### `sponsored_placements`

- placement, chain, token, and feed identity
- separate sponsored priority
- active time range
- required label and disclosure
- actor and timestamps

### `sponsored_placement_audit`

- placement identity
- action and actor
- before and after payloads
- reason and recorded time

Sponsorship records never update discovery snapshots or risk records.

## Retention

- Raw canonical chain facts: indefinite.
- Orphaned chain facts: indefinite but marked noncanonical.
- Notification delivery bodies: redact and expire after 30–90 days.
- Session and security logs: per privacy policy, normally 90 days.
- Admin audit log: indefinite or legally appropriate.
- Provider raw payloads: only as required for debugging; redact secrets.
