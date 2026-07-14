# External protocol adapters

## Scope

Hood Sentry indexes and prepares transactions for external Robinhood Chain liquidity venues and
token launchpads. Hood Sentry does not deploy or maintain venue contracts. Production configuration
must reference contracts operated by each external protocol.

The adapter manager gives the indexer one routing path for DEX and launchpad events. Protocol code
stays inside the chain package. Adding a venue does not add protocol branches to the block indexer.

## Production status

The production registry enables one adapter:

- Protocol: Uniswap
- Version: v2
- Chain ID: 4663
- Factory: `0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f`
- Router02: `0x89e5DB8B5aA49aA85AC63f691524311AEB649eba`
- Official source: `https://developers.uniswap.org/docs/protocols/v2/deployments`
- Factory runtime hash: `0xbab145d02e7005f0d84c6c1639d39b799b0ea16df99ebbdaf5a14d9da820b4e0`
- Router runtime hash: `0xbd55ea26b2f8d42a8ff151511cef92a326a9817686899fe96a8a8f81ee7fc55e`
- Verification date: 2026-07-14

The adapter has no quoter, position manager, or Permit2 entry because Uniswap v2 does not require
those roles for this route. Every launchpad stays disabled. No launchpad has complete official
factory, bonding-curve, migration, and runtime-bytecode evidence yet.

Fixture addresses exist only in tests. Production configuration contains no fixture launchpad or
pool address.

## Registry and startup validation

`packages/chain/src/protocol-adapters/registry.ts` contains the versioned production registry. Each
contract entry records its role, checksummed address, chain ID, official source, explorer link,
verification time, expected runtime hash, proxy metadata when needed, enabled state, and protocol
version.

Startup validation performs these checks:

1. Parse the registry with Zod.
2. Reject invalid and zero addresses.
3. Reject duplicate protocol identities, duplicate roles, and conflicting roles for one address.
4. Read the RPC chain ID through the shared resilient provider.
5. Read runtime bytecode for every enabled contract.
6. Compare Keccak-256 runtime hashes with the registry.
7. Read EIP-1967 implementation and admin slots for configured proxies.
8. Disable the full adapter after any mismatch or provider failure.
9. Emit an operational alert with a stable failure code.
10. Persist each validation result and contract observation with checked and expiry times.

Validation results use a five-minute cache by default. Quote and transaction requests read this
validated state. They do not fetch bytecode for every request. Periodic refresh replaces stale
state. A changed contract disables the adapter and blocks future quote or transaction work.

Explorer metadata never activates an adapter. Direct chain state and official deployment evidence
remain required.

## Package layout

The implementation follows the repository's established `src/protocol-adapters` layout:

- `types.ts` defines shared registry, event, pool, swap, liquidity, quote, route, transaction, and
  launchpad models.
- `validation.ts` validates configuration and chain state.
- `registry.ts` holds production definitions and disabled requirements.
- `factory.ts` activates verified implementations.
- `manager.ts` routes logs without protocol-specific indexer branches.
- `dex/` exposes pool discovery, swap, liquidity, quote, and transaction contracts.
- `launchpads/` exposes token creation, bonding-curve, graduation, and migration contracts.
- `uniswap-v2.ts` implements the currently verified DEX adapter.

## Indexing flow

The block indexer persists each raw log before protocol handling. Protocol handling then follows
this sequence:

1. Match the emitter against active verified factories, registered pools, or launchpad contracts.
2. Decode through the matching adapter.
3. Persist a protocol-neutral record with chain and transaction provenance.
4. Publish deterministic metric, wallet, token, risk, or alert jobs.
5. Isolate malformed and unsupported events from the block loop.

Pool discovery reads token0, token1, and factory directly from the pool. The adapter checks runtime
bytecode and the factory `getPair` result before persistence. Discovery writes pool-token membership
and publishes state refresh, token metadata, liquidity analysis, and risk analysis jobs.

Reorg handling marks affected pools, swaps, liquidity records, launchpad tokens, curve trades,
graduations, and migrations noncanonical. Canonical replacement logs use block-hash-aware
idempotency keys.

## Integer models

Token addresses identify assets. Symbols never serve as identity. Raw token amounts, reserves,
fees, price impact, and quote values use bigint values. JSON read APIs serialize bigint values as
decimal strings.

The normalized pool model supports constant-product, concentrated-liquidity, stable-swap,
bonding-curve, RFQ, and unknown types. Every pool, swap, liquidity event, and launchpad event stores
protocol version and block provenance.

Creator and protocol fees stay attached to their source trade record. Creator fees also enter a
dedicated event table with the same transaction hash, block hash, and log index.

## Quotes and transaction preparation

Adapters produce short-lived quotes with a source block, explicit route, expected output, minimum
output, fees, price impact, spender, target, and selector. The adapter fingerprints each issued
quote. A client route change invalidates the fingerprint.

Transaction preparation performs these gates:

1. Server trading flags permit the chain and environment.
2. The requested chain matches the adapter chain.
3. The adapter validation cache is active and fresh.
4. The quote has not expired.
5. Route pools and token direction match verified factory state.
6. The target, spender, and selector match adapter allowlists.
7. Calldata contains the quoted amount, minimum output, recipient, route, and deadline.
8. Shared RPC simulation succeeds.
9. The adapter decodes simulation output and returns expected state changes.

The adapter never signs or broadcasts. Prepared results feed the shared transaction-intent system.
All writes stay disabled unless server configuration enables the required feature flags.

## Launchpad support

Launchpad interfaces normalize token creation, curve buys, curve sells, graduation, and DEX
migration. The model preserves creator, token implementation, initial supply, bonding curve,
graduation threshold, migration contract, destination protocol, destination pool, creator fee, and
protocol fee data when the venue emits or exposes those fields.

Launchpad fixtures verify the architecture in unit and integration tests. No production launchpad
adapter is active. A launched token still enters normal token discovery and risk analysis.

## Adding a protocol

Use this process for each new version and chain deployment:

1. Collect official deployment documentation for every required contract role.
2. Confirm the chain ID and checksummed addresses from a separate chain RPC.
3. Record runtime bytecode hashes and proxy implementation or admin values where relevant.
4. Add one versioned registry definition with `enabled: false`.
5. Implement the DEX or launchpad interface without placing addresses in adapter code.
6. Define supported fee tiers, event signatures, contract roles, and selector allowlists.
7. Add fixture tests for decoding, malformed logs, provider failure, reorgs, quotes, and simulation.
8. Register the adapter factory.
9. Run startup verification against the target chain.
10. Set `enabled: true` only after every production contract passes validation.

Never copy an address from social media, an aggregator response, or unverified explorer metadata.
Never place pool addresses in production registry configuration. Factories remain the pool source.
