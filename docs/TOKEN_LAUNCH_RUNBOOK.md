# Token Launch Runbook

## Pre-deployment decisions

Finalize:
- token name and symbol;
- total fixed supply;
- decimals, normally 18;
- allocation table;
- vesting recipients and schedules;
- treasury Safe signers and threshold;
- liquidity amount and pair;
- official website/domain/social accounts;
- legal notices;
- contract source license.

Recommended pair: Sentry token against canonical USDG or WETH, based on verified venue support and intended user experience. Do not send liquidity to an address copied from an unofficial post.

## Wallet and authority setup

- Hardware-wallet-backed deployer.
- Treasury Safe with at least 2-of-3 signers.
- Operations Safe if separate.
- TimelockController.
- Small deployer balance only.
- No seed phrase in shell history, `.env`, Codex context, or cloud logs.

## Testnet rehearsal

1. Deploy token.
2. Deploy distribution vault and vesting.
3. Deploy AccessStaking.
4. Deploy ProjectRegistry.
5. Deploy ProjectBondVault.
6. Deploy ReportRegistry.
7. Configure roles.
8. Transfer roles to Safe/timelock.
9. Verify source.
10. Run end-to-end frontend transactions.
11. Exercise pause and exit.
12. Confirm events index correctly.
13. Save deployment manifest and bytecode hashes.
14. Repeat from a clean state using scripts only.

## Mainnet deployment

1. Confirm RPC chain ID `4663`.
2. Pin git commit.
3. Run full contract suite and analyzers.
4. Generate deployment simulation.
5. Deploy with hardware wallet or approved broadcaster.
6. Verify each source on Blockscout.
7. Compare deployed runtime bytecode to build artifact.
8. Transfer all roles.
9. Revoke deployer roles.
10. Publish addresses and hashes.
11. Seed application config.
12. Confirm indexer recognizes contracts.
13. Keep transactional feature flags disabled until smoke tests pass.

## Liquidity

- Verify the current official DEX deployment and pool creation path.
- Confirm token ordering, fee tier, initial price, and tick range where applicable.
- Simulate pool creation.
- Use a documented liquidity wallet/Safe.
- Publish liquidity position address or LP ownership.
- Do not claim liquidity is locked unless enforceably locked and independently verifiable.
- Avoid misleading initial valuation.
- Test a small buy and sell.
- Confirm quotes and chart indexing.
- Set monitoring alerts for liquidity changes.

## Distribution

- Team allocations go directly to vesting.
- Community claims use a reviewed Merkle distributor.
- Treasury allocation stays in Safe.
- Publish all allocation wallets.
- Do not manually transfer large allocations from a personal wallet.
- Reconcile distributed amount against fixed supply.

## Public launch package

- Verified contract address.
- Explorer links.
- Allocation and vesting table.
- Product utility.
- Methodology.
- Risk disclosure.
- Terms and privacy.
- No price promise.
- No “guaranteed returns.”
- No false audit claim.
- Warning about impersonator contracts.

## Post-launch monitoring

- admin-role changes;
- Safe signer changes;
- timelock operations;
- token distribution;
- vesting releases;
- pool liquidity;
- price impact;
- suspicious approval/spender activity;
- website/DNS changes;
- fake token addresses;
- provider/indexer health.
