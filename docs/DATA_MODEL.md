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

### `stock_token_metadata`
- `token_id`
- `underlying_ticker`
- `official`
- `ui_multiplier_raw`
- `pending_multiplier_raw`
- `multiplier_effective_at`
- `oracle_paused`
- `feed_address`
- `feed_decimals`
- `heartbeat_seconds`
- `source_url`
- `verified_at`

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
- protocol key, version, factory/router/quoter addresses, verification source and date

### `pools`
- `chain_id`
- `address`
- `protocol`
- `token0`
- `token1`
- `fee_tier`
- `created_block`
- `created_tx_hash`
- `active`

### `swaps`
- chain provenance columns
- `pool_address`
- `sender`
- `recipient`
- amount fields
- normalized USD value when available
- price impact estimate when available

### `liquidity_events`
- mint/burn/add/remove classification
- provider
- owner
- token amounts
- USD estimate
- chain provenance

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
- target chain/address
- engine version
- ruleset version
- source block
- status
- started/completed
- error code

### `risk_findings`
- scan ID
- rule ID/version
- category
- severity
- confidence
- title
- explanation
- evidence JSON
- remediation
- source provenance
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

## Retention

- Raw canonical chain facts: indefinite.
- Orphaned chain facts: indefinite but marked noncanonical.
- Notification delivery bodies: redact and expire after 30–90 days.
- Session and security logs: per privacy policy, normally 90 days.
- Admin audit log: indefinite or legally appropriate.
- Provider raw payloads: only as required for debugging; redact secrets.
