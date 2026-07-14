# Product Requirements Document

## Product

**Working name:** Hood Sentry  
**Category:** Robinhood Chain intelligence and safety terminal  
**Primary promise:** Discover assets, inspect risks, understand wallets, receive actionable alerts, and verify project identity without surrendering custody.

## Problem

A newly launched permissionless chain creates an information gap. Tokens, liquidity pools, and wallets appear faster than reliable metadata, security analysis, and user-facing monitoring. Users encounter duplicate tickers, owner-controlled contracts, concentrated supply, removable liquidity, proxy upgrades, impersonation, and opaque wallet activity.

The product must convert raw onchain activity into evidence-backed information.

## Target users

- Traders seeking new assets and liquidity.
- Holders monitoring portfolio value and risk exposure.
- Project teams claiming official profiles.
- Researchers inspecting deployers, holders, and token mechanics.
- Wallets, bots, and applications consuming risk data through an API.
- Communities receiving Telegram, email, webhook, or browser alerts.

## Product modules

### 1. Discovery

- New tokens and new liquidity pools.
- Trending by volume, transaction count, unique traders, liquidity change, and holder growth.
- Canonical Robinhood Stock Tokens and ETFs shown in a separate verified category.
- Search by address, symbol, name, project, deployer, or wallet.
- Duplicate-symbol and impersonation warnings.

### 2. Token intelligence

- Price, liquidity, volume, market capitalization when computable, fully diluted valuation, holders, transfers, and pool information.
- Contract verification and source links.
- Proxy implementation and admin.
- Ownership and privileged capabilities.
- Mint, pause, blacklist, fee, max-wallet, max-transaction, trading-toggle, and upgrade controls.
- Holder concentration with known pool, burn, treasury, vesting, and bridge addresses classified.
- Deployer funding and related-contract graph.
- Liquidity creation, addition, removal, and lock evidence.
- Explainable risk findings and score.

### 3. Wallet intelligence

- Native and ERC-20 balances.
- Canonical Stock Token balances with multiplier-aware display.
- Estimated cost basis, realized P&L, unrealized P&L, and cash flows.
- Token approvals and risky allowances.
- Counterparty and deployer exposure.
- Portfolio risk summary.
- Watchlists and labels.

### 4. Alerts

- Price threshold.
- Volume or liquidity spike.
- Liquidity removal.
- Owner or proxy-admin change.
- Contract upgrade.
- Mint, burn, pause, blacklist, fee change, or trading-toggle event.
- Whale transaction.
- Holder-concentration movement.
- Deployer movement.
- New pool or token.
- Oracle pause, stale price, or corporate-action multiplier update for Stock Tokens.
- Delivery by in-app, browser push, Telegram, email, and webhook.

### 5. Project verification

- Wallet-signed profile claim.
- Official contracts, links, team wallets, treasury, tokenomics, audit links, and metadata.
- DNS or social proof as optional offchain verification.
- Project bond in the utility token.
- Immutable history of profile changes.
- Clear separation between “identity verified,” “contract reviewed,” and “safe.” Verification is never a safety guarantee.

### 6. Community reports

- Evidence-backed reports against tokens, wallets, projects, or profiles.
- Reporter bond to discourage spam.
- Objective reason codes.
- Public resolution history.
- Appeals.
- No automated slashing from an AI judgment or popularity vote.

### 7. Trading

- Non-custodial quotes and swaps through verified external liquidity venues.
- Transaction simulation, price impact, minimum received, deadline, spender, allowance, and route shown before signing.
- Permit support where safely available.
- Approval revocation.
- No custody and no private-key collection.

### 8. Utility token

- Launchpad-created utility token identified by verified chain and address.
- Holding-based product access with no token locking.
- Offchain project profiles with auditable application-level verification.
- Offchain community reports with auditable moderation.
- Product-fee discounts.
- Governance can be added only after real governance surfaces exist.
- No dividend, guaranteed return, revenue-share promise, or passive-yield representation.

### 9. API

- Token metadata and metrics.
- Risk reports.
- Wallet portfolio.
- Alerts and webhooks.
- Project profiles.
- API keys, plans, quotas, audit logs, and signed webhooks.

## Non-functional requirements

- Read paths remain useful during partial provider failure.
- Chain state is reorg-aware and reproducible.
- API p95 below 500 ms for cached token pages.
- Fresh chain events visible within 10 seconds under normal operation.
- No financial arithmetic using floating point.
- WCAG-minded responsive UI.
- Full audit trail for admin actions.
- Feature flags for every transactional or privileged module.
- Graceful degradation when price, source code, holder data, or protocol metadata is unavailable.

## Success metrics

- Time from pool creation to discovery.
- Percentage of token pages with completed risk analysis.
- Alert delivery success and latency.
- Weekly active connected wallets.
- Watchlists created.
- Verified project profiles.
- API customers and successful API requests.
- False-positive and false-negative review rates for risk rules.
- Percentage of transactions simulated successfully before user signing.

## Explicit product language

Use:
- “risk signals”
- “verified contract address”
- “identity claim”
- “evidence”
- “estimated”
- “unavailable”
- “not financial advice”

Do not use:
- “guaranteed safe”
- “audited” unless an actual audit exists
- “risk-free”
- “official” without a verified source
- “AI knows”
- “guaranteed return”
