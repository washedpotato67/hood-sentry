# External Contract Policy

Sentry does not deploy or maintain application smart contracts.

`$SENTRY` is created through a separately selected and verified external Robinhood Chain launchpad. The launchpad evaluation, launch manifest, transaction review, and simulation must finish before any launch transaction is presented. Sentry does not broadcast or sign the launch transaction.

Project profiles, community reports, moderation, watchlists, alerts, token entitlements, and API access stay in Sentry services. Product access uses verified token holdings. The product does not use token locking, bonds, or slashing.

## Contract registries

Every external contract record must include:

- chain ID
- checksummed address
- contract role
- official source URL
- explorer URL
- verification time
- runtime bytecode hash
- proxy type, implementation, and admin where relevant
- enabled state

Startup verification rejects zero addresses, wrong-chain contracts, bytecode changes, proxy conflicts, and duplicate roles. Failed verification disables the related adapter and write path.

## Transaction rules

All chain writes pass through the transaction-intent service. The server binds the wallet, chain, target, selector, decoded arguments, calldata, value, quote, configuration version, expiry, and simulation result. The client reviews and signs. The wallet broadcasts.

Sentry never stores private keys, signs user transactions, accepts arbitrary calldata, or treats explorer metadata as chain truth.

## `$SENTRY` requirements

The official token record is identified by chain ID and contract address. Symbol and name are display metadata only. The record must preserve creation transaction, creation block, creator, launchpad, factory, curve, runtime code hash, supply, pool, quote asset, graduation state, migration transaction, liquidity ownership, and fee recipients.

Token access stays disabled until direct `balanceOf` reads, indexed balances, bytecode identity, reorg handling, holding-duration rules, and entitlement thresholds pass production validation.

## Launch gates

- independently verify every launchpad dependency
- compare runtime bytecode with the recorded hash
- resolve proxy implementation and admin from direct chain state
- validate fees, supply mechanics, creator allocation, and liquidity destination
- reject unexplained mint, confiscation, transfer blocking, upgrade, or approval behavior
- simulate the exact transaction at a pinned block
- verify target, selector, arguments, value, fee recipients, and expected contracts
- keep mainnet writes disabled after any failed check
- publish the official address and verification evidence after canonical inclusion

The current repository contains a local fixed-supply token fixture for deterministic contract tests. The fixture is not a production deployment dependency and is not an official `$SENTRY` address.
