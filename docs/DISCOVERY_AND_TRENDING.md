# Deterministic Discovery and Trending

## Scope

Hood Sentry materializes token discovery records from indexed chain facts and versioned derived data. The discovery layer does not replace token, pool, price, holder, project, risk, watchlist, alert, or launchpad records.

Each snapshot records its source block, source block hash, observation time, canonical state, methodology version, organic score, confidence, score components, manipulation evidence, warnings, and the public token view.

## Feeds

The API supports these feed keys:

- `newTokens`
- `newPools`
- `trending`
- `volumeGainers`
- `liquidityGainers`
- `holderGainers`
- `transactionActivityGainers`
- `newlyGraduated`
- `recentlyMigrated`
- `recentlyVerifiedProjects`
- `recentlyScanned`
- `recentCriticalRisk`
- `canonicalStockTokens`
- `canonicalEtfTokens`
- `mostWatched`
- `mostAlerted`

Every comparator has a fixed address tie break. Noncanonical snapshots never enter a feed. Missing values sort after present values. Missing price or holder data stays `null` and adds an explicit warning.

## Trending methodology

`trending-v1` stores every positive component and penalty. The score excludes price increase. Positive inputs cover integer log-scaled volume, unique traders, transaction acceleration, holder growth, liquidity, liquidity growth, pool age, token age, watchlist growth, alert creation growth, launchpad curve progress, graduation state, and risk completeness.

Penalties cover observed manipulation patterns, holder concentration, low liquidity, suspicious deployer evidence, duplicate symbols, and data-quality warnings.

Every component stores:

- raw integer value or unavailable state
- normalized basis points
- weight in basis points
- weighted contribution
- availability
- reason codes

All financial arithmetic uses bigint values and explicit decimals. Integer `log2` scaling avoids floating-point financial arithmetic.

## Manipulation evidence

`manipulation-v1` evaluates canonical indexed trades for these patterns:

- matching sender and recipient
- repeated wallet pairs
- one-wallet volume concentration
- circular wallet flow
- rapid buy and sell loops
- tiny trade count inflation
- high price impact in thin pools
- supplied wallet-cluster evidence
- launchpad transaction bursts

Signals use `observed`, `notObserved`, or `insufficientData`. An observed signal includes confidence, penalty, transaction hashes, wallet addresses, and measured facts. The model describes activity patterns. The model does not label a wallet or token as malicious.

## Search

Search ranks exact contract, pool, deployer, and wallet address matches first. Address matches work when token name and symbol are missing. Text matching covers token name, token symbol, project name, project slug, launchpad key, and canonical ticker.

Canonical Stock Token and ETF Token identity comes from exact chain ID and contract address registry matches. A community token using `AAPL` or another official ticker does not receive canonical status. Duplicate ticker results include every known contract address and a duplicate warning.

## Filters

The feed API supports token age, pool age, minimum liquidity, minimum volume, minimum holders, risk grade, risk completeness, project verification, canonical state, protocol, launchpad, quote asset, migration state, graduation state, Stock Token category, ETF category, and maximum data age.

Unknown values fail minimum-value filters. Unfiltered feeds still expose unknown values as unavailable.

## Sponsorship

Sponsored placements have separate storage, pagination, rank, labels, disclosure text, active dates, and audit history. A placement does not edit organic score, organic order, risk severity, warnings, canonical state, or project verification.

The API returns `organic` and `sponsored` pages as separate objects. Sponsored items always carry the `Sponsored` label and disclosure text.

## API

Feed request:

```text
GET /v1/discovery/:feed?chainId=4663&limit=25&cursor=...
```

Search request:

```text
GET /v1/search?chainId=4663&query=0x...&limit=25&cursor=...
```

Cursors bind to the full query and reject reuse across another feed, filter set, or search term. Raw integers use decimal strings in JSON.

## Refresh and reorg flow

`DiscoveryRefreshJob` loads an indexed candidate at a named source block, calculates a deterministic snapshot, and writes the immutable history plus current projection. Its idempotency key includes chain ID, token address, and source block.

`DiscoveryReorgJob` marks affected snapshots noncanonical, removes affected current projections, and publishes recomputation for the canonical replacement range. Historical noncanonical records stay available for audit.

## Source integration contract

The candidate loader reads existing indexed sources and passes these facts to the pure engine:

- token and deployer identity
- verified pool and protocol identity
- current deterministic price observation
- 24-hour market metrics
- current and prior holder snapshots
- canonical swaps and launchpad trades
- launchpad creation, graduation, and migration state
- project verification
- risk scan completeness and findings
- watchlist and alert counts
- open data-quality warnings

The loader must preserve source block provenance and leave missing inputs unavailable. The pure engine does not fetch providers or trust client routes.
