# Deterministic Pricing and Market Metrics

## Trust model

Prices are derived data. Every observation records its source, contract or provider, route, source
block, block hash, source time, observation time, liquidity depth, confidence, status, canonical
state, reasons, and methodology version.

The engine identifies assets by chain ID and checksummed contract address. A ticker or token symbol
never selects a price source.

Unknown, rejected, and unavailable prices use `null`. A zero price is invalid data, not a missing
value substitute.

## Source hierarchy

The registry supports these source types in priority order configured per token and quote asset:

1. Official Chainlink feed
2. Verified launchpad bonding curve
3. Verified stablecoin liquidity pool
4. Verified WETH route
5. Verified direct DEX route
6. Verified multihop route
7. Trusted external market-data provider
8. Unavailable

Priority does not override source validation. An enabled onchain source needs an independently
verified source contract. Pool sources also need an active protocol adapter, a verified factory,
matching token state, current pool state, enough liquidity, and acceptable price impact. External
providers remain external evidence and use attribution, timestamp validation, decimal validation,
and rate limits.

`productionPriceSources` is empty. No Chainlink proxy and heartbeat set, launchpad, production pool,
or external provider has completed independent pricing-source verification. The system returns
unavailable instead of activating fixture or inferred addresses.

## Integer arithmetic

All token quantities, prices, confidence values, changes, valuations, and price impacts use bigint
values or decimal strings. Each value carries an explicit decimal scale. Division rounds down and
tests define the rounding rule. JavaScript floating-point arithmetic is not used for financial
values.

For a constant-product pool, the token price in quote units is:

```text
reserveQuoteRaw * 10^tokenDecimals * 10^priceDecimals
------------------------------------------------------
          reserveTokenRaw * 10^quoteDecimals
```

## Bonding-curve transition

A launchpad adapter supplies a verified formula key, parameter hash, state ratio, supply state,
graduation state, and migration state. The pricing engine does not assume one launchpad formula.

The curve source stops after migration. The migration job activates a DEX source only after the
destination pool passes protocol and pool verification. If the destination fails verification, the
token price stays unavailable.

## Outlier policy

The engine preserves the original observation and records reason codes. It does not clamp prices or
replace suspicious values.

Reason codes cover:

- thin liquidity
- extreme price impact
- one-transaction manipulation
- stale pool or oracle state
- source disagreement
- negative or zero prices
- invalid decimals
- large price jumps
- stablecoin depeg
- flash-volume spikes
- one-wallet wash volume
- post-graduation source mismatch

Fatal validation failures produce unavailable observations. Other failures lower confidence and
prevent authoritative selection.

## Metrics

The engine produces candles and market metrics for 1 minute, 5 minute, 15 minute, 1 hour, 6 hour,
24 hour, 7 day, and 30 day windows where history exists.

Metrics include OHLC, volume, buy and sell volume, counts, unique traders, liquidity, price change,
volume change, liquidity change, holder change, transaction growth, average and median trade size,
whale volume, and standard-order-size price impact.

Market capitalization uses a reliable circulating-supply observation only. Fully diluted valuation
uses total supply. The record keeps the circulating-supply methodology and excluded addresses.

## Reproducibility and reorgs

Observations use deterministic source keys. Candles and metrics use compound keys containing the
asset, quote asset, window, bucket, and methodology version. Repeated jobs update the same record.

A reorg marks observations from orphaned blocks noncanonical. The system also invalidates derived
chain aggregates and publishes recomputation work. Raw swap and launchpad events remain separate
from pricing data.

## Adding a source

1. Verify the source through an official deployment reference and explorer source record.
2. Verify the chain ID, runtime bytecode, proxy state, and related protocol registry entry.
3. Add a versioned source configuration with minimum liquidity, staleness, priority, confidence
   rules, route, and methodology version.
4. Run source activation validation.
5. Add fixtures for valid, stale, malformed, manipulated, outage, and reorg cases.
6. Keep the source disabled until live verification passes.

For Stock Tokens and ETF Tokens, use the official token contract address as identity. Chainlink feed
prices already reflect the corporate-action multiplier. The UI share-equivalent multiplier must
not be applied to the token price a second time.
