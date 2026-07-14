# `$SENTRY` Launchpad Runbook

Sentry does not deploy or maintain its own smart contracts. This runbook reviews and rehearses a launch through an independently verified external Robinhood Chain launchpad. No step authorizes a mainnet broadcast.

## Required decisions

- token name and symbol
- description, logo, website, and official social accounts
- product utility language
- supply and curve mechanics
- graduation threshold
- migration venue and quote asset
- creator and protocol fees
- creator allocation
- creator wallet and treasury Safe
- liquidity ownership and withdrawal conditions
- legal notices and anti-impersonation language

Do not describe the token as equity, revenue ownership, guaranteed yield, guaranteed return, passive income, company profit participation, or risk-free.

## Launchpad verification

Record the official site, official documentation, entity, terms, eligibility, factory, token implementation, curve, migration contract, fee collector, destination venue, approval requirements, source verification, audits, and known incidents.

For every contract record the chain ID, checksummed address, role, official source, explorer verification, runtime bytecode, bytecode hash, proxy type, implementation, admin, and verification time.

Reject the launchpad when contracts are unverified, supply is arbitrarily mintable, transfers or balances are arbitrarily controlled, liquidity ownership is misleading, upgrade authority is unexplained, documentation conflicts with code, or the frontend requests arbitrary approvals.

## Launch manifest

The immutable review artifact includes:

- chain ID
- launchpad and factory version
- creator wallet and treasury Safe
- metadata and sources
- target, function, selector, decoded arguments, and value
- fees, supply, curve, graduation threshold, and migration venue
- liquidity ownership
- runtime bytecode hashes
- creation time and expiry

## Rehearsal

Use an official testnet when the same verified contracts exist there. Otherwise fork Robinhood Chain at a fixed block and simulate locally with disposable accounts.

1. Fetch the proposed transaction from the verified adapter.
2. Confirm chain ID, target, selector, arguments, value, and fee recipients.
3. Compare runtime bytecode and proxy state with the verified registry.
4. Check metadata, supply, allocation, curve, graduation, and migration fields.
5. Simulate the exact transaction.
6. Decode created contracts and emitted events.
7. Compare expected and observed balances, supply, fees, and ownership.
8. Save the fork block, RPC identity, calldata hash, trace, receipts, and result.
9. Reject arbitrary calldata, unknown factories, changed bytecode, or failed simulation.

## Canonical launch processing

After a separately approved wallet broadcasts, the indexer waits for canonical inclusion and records the token address, creation transaction, block, creator, factory, curve, code hash, metadata, supply, pool, quote asset, graduation, migration, liquidity ownership, and fee recipients.

Publish `$SENTRY` only by chain ID and address. Publish the explorer link, creation transaction, code hash, official website, official socials, and verification time. Treat copied names and symbols as impersonation candidates.

## Enablement gates

- official launchpad dependencies match direct chain state
- launch simulation passes at a pinned block
- creation transaction is canonical
- official token record matches direct chain state
- supply, creator, treasury, curve, pool, liquidity, and fee recipients reconcile
- direct and indexed token balances reconcile
- token entitlement holding-duration rules pass
- monitoring and kill switches are active
- trading stays disabled until a documented smoke trade passes

Any unexplained token identity, supply, curve, migration, liquidity, or fee discrepancy stops the affected feature.
