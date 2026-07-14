# Protocol adapters

## Trust boundary

The protocol registry is the only source for venue contract addresses. An enabled contract entry
needs an official HTTPS source, a verification date, a checksummed address, and a direct runtime
bytecode hash. Adapter construction fails when a required role is missing.

Quote and transaction preparation repeat these checks against direct chain state:

1. RPC chain ID matches the adapter chain ID.
2. Factory runtime bytecode matches the registry hash.
3. Router or quoter runtime bytecode matches the registry hash.
4. Every route pool reports the verified factory and expected token pair.
5. Every route fee belongs to the adapter fee list.
6. Transaction preparation includes a future deadline, calldata intent, and successful simulation.

Explorer metadata does not enable an adapter and does not replace direct bytecode verification.

## Normalized model

Fees use millionths, with `1_000_000` as the denominator. A value of `3_000` represents 0.30
percent. Token amounts, reserves, liquidity, quotes, and price impact calculations use integers.

Every normalized pool, swap, and liquidity event includes chain ID, block number, block hash,
transaction hash, and log index. Pool state uses a tagged union:

- `constant-product` stores reserve0, reserve1, and LP total supply.
- `concentrated-liquidity` stores sqrt price, tick, and active liquidity.

The generic manager maps factories and pools to adapter interfaces. Indexer code routes logs through
the manager without protocol-version branches. A new venue needs a registry record, an adapter, and
one adapter-factory registration inside the chain package.

## Verified deployment

The enabled mainnet adapter is Uniswap v2. Uniswap lists the Robinhood Chain factory and Router02 in
its official deployment registry:

- Source: https://developers.uniswap.org/docs/protocols/v2/deployments
- Factory: `0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f`
- Router02: `0x89e5DB8B5aA49aA85AC63f691524311AEB649eba`

Direct Robinhood Chain RPC checks on 2026-07-14 returned chain ID 4663 and these runtime hashes:

- Factory: `0xbab145d02e7005f0d84c6c1639d39b799b0ea16df99ebbdaf5a14d9da820b4e0`
- Router02: `0xbd55ea26b2f8d42a8ff151511cef92a326a9817686899fe96a8a8f81ee7fc55e`

No quoter, position manager, or Permit2 address is assigned to this adapter. No other Robinhood Chain
venue has enough official address and bytecode evidence in the registry.
