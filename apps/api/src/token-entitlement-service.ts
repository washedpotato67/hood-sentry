import { type Database, schema } from '@hood-sentry/db';
import {
  type GateConfig,
  type Tier,
  advanceEntitlementState,
  calculateTier,
} from '@hood-sentry/entitlements';
import { and, eq, gt, or } from 'drizzle-orm';
import { getAddress, isHash, keccak256 } from 'viem';
import { z } from 'zod';

const tierSchema = z.enum(['free', 'scout', 'analyst', 'sentinel']);

export type TokenGateRuntimeConfig =
  | { enabled: false; chainId: number; version: string }
  | (GateConfig & {
      enabled: true;
      runtimeBytecodeHash: `0x${string}`;
      verificationSourceUrl: string;
      verifiedAt: string;
    });

export type TokenEntitlementChainReader = {
  getChainId(): Promise<number>;
  getBytecode(address: `0x${string}`, blockNumber: bigint): Promise<`0x${string}` | undefined>;
  balanceOf(
    tokenAddress: `0x${string}`,
    walletAddress: `0x${string}`,
    blockNumber: bigint,
  ): Promise<bigint>;
};

export class TokenEntitlementService {
  constructor(
    private readonly database: Database,
    private readonly chain: TokenEntitlementChainReader,
    private readonly config: TokenGateRuntimeConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async status(walletAddresses: readonly string[]) {
    if (!this.config.enabled) return this.unavailable('TOKEN_GATE_DISABLED');
    if (walletAddresses.length === 0) return this.unavailable('VERIFIED_WALLET_REQUIRED');
    const rows = await this.database.db
      .select()
      .from(schema.tokenEntitlementStates)
      .where(
        and(
          eq(schema.tokenEntitlementStates.chainId, this.config.chainId),
          eq(schema.tokenEntitlementStates.tokenAddress, this.config.tokenAddress.toLowerCase()),
          or(
            ...walletAddresses.map((address) =>
              eq(schema.tokenEntitlementStates.walletAddress, address.toLowerCase()),
            ),
          ),
        ),
      );
    const current = rows
      .filter((row) => row.expiresAt > this.now() && row.status !== 'unavailable')
      .sort((left, right) => (right.observedBlock < left.observedBlock ? -1 : 1))[0];
    return current === undefined
      ? this.unavailable('ENTITLEMENT_RECONCILIATION_REQUIRED')
      : this.view(current);
  }

  async reconcile(walletAddress: string) {
    if (!this.config.enabled) return this.unavailable('TOKEN_GATE_DISABLED');
    const config = this.config;
    const wallet = getAddress(walletAddress);
    if ((await this.chain.getChainId()) !== config.chainId) {
      return this.unavailable('CHAIN_ID_MISMATCH');
    }
    const indexed = await this.database.db
      .select({
        balanceRaw: schema.tokenBalances.balance_raw,
        asOfBlock: schema.tokenBalances.as_of_block,
      })
      .from(schema.tokenBalances)
      .where(
        and(
          eq(schema.tokenBalances.chain_id, config.chainId),
          eq(schema.tokenBalances.token_address, config.tokenAddress.toLowerCase()),
          eq(schema.tokenBalances.wallet_address, wallet.toLowerCase()),
        ),
      )
      .limit(1);
    const indexedBalance = indexed[0];
    if (indexedBalance === undefined) return this.unavailable('INDEXED_TOKEN_BALANCE_UNAVAILABLE');
    const blocks = await this.database.db
      .select({ hash: schema.blocks.hash, timestamp: schema.blocks.timestamp })
      .from(schema.blocks)
      .where(
        and(
          eq(schema.blocks.chainId, BigInt(config.chainId)),
          eq(schema.blocks.number, indexedBalance.asOfBlock),
          eq(schema.blocks.canonical, true),
        ),
      )
      .limit(1);
    const block = blocks[0];
    if (block === undefined || !isHash(block.hash)) {
      return this.unavailable('ENTITLEMENT_SOURCE_BLOCK_UNAVAILABLE');
    }
    const bytecode = await this.chain.getBytecode(config.tokenAddress, indexedBalance.asOfBlock);
    if (bytecode === undefined || keccak256(bytecode) !== config.runtimeBytecodeHash) {
      return this.unavailable('SENTRY_TOKEN_BYTECODE_MISMATCH');
    }
    const identities = await this.database.db
      .select({
        tokenAddress: schema.tokens.address,
        bytecodeHash: schema.contracts.bytecode_hash,
      })
      .from(schema.tokens)
      .innerJoin(
        schema.contracts,
        and(
          eq(schema.contracts.chain_id, schema.tokens.chain_id),
          eq(schema.contracts.address, schema.tokens.address),
        ),
      )
      .where(
        and(
          eq(schema.tokens.chain_id, config.chainId),
          eq(schema.tokens.address, config.tokenAddress.toLowerCase()),
        ),
      )
      .limit(1);
    if (identities[0]?.bytecodeHash?.toLowerCase() !== config.runtimeBytecodeHash.toLowerCase()) {
      return this.unavailable('INDEXED_SENTRY_IDENTITY_UNVERIFIED');
    }
    const directBalance = await this.chain.balanceOf(
      config.tokenAddress,
      wallet,
      indexedBalance.asOfBlock,
    );
    const indexedBalanceRaw = BigInt(indexedBalance.balanceRaw);
    if (directBalance !== indexedBalanceRaw) {
      return this.unavailable('SENTRY_BALANCE_RECONCILIATION_MISMATCH');
    }
    const eligibleTier = calculateTier(directBalance, config);
    const rows = await this.database.db.transaction(async (transaction) => {
      const existingRows = await transaction
        .select()
        .from(schema.tokenEntitlementStates)
        .where(
          and(
            eq(schema.tokenEntitlementStates.chainId, config.chainId),
            eq(schema.tokenEntitlementStates.tokenAddress, config.tokenAddress.toLowerCase()),
            eq(schema.tokenEntitlementStates.walletAddress, wallet.toLowerCase()),
          ),
        )
        .for('update')
        .limit(1);
      const existing = existingRows[0];
      const candidateStartBlock = existing?.candidateStartBlock;
      const transferRows =
        candidateStartBlock === null || candidateStartBlock === undefined
          ? []
          : await transaction
              .select({ id: schema.tokenTransfers.id })
              .from(schema.tokenTransfers)
              .where(
                and(
                  eq(schema.tokenTransfers.chain_id, config.chainId),
                  eq(schema.tokenTransfers.token_address, config.tokenAddress.toLowerCase()),
                  eq(schema.tokenTransfers.canonical, true),
                  gt(schema.tokenTransfers.block_number, candidateStartBlock),
                  or(
                    eq(schema.tokenTransfers.from_address, wallet.toLowerCase()),
                    eq(schema.tokenTransfers.to_address, wallet.toLowerCase()),
                  ),
                ),
              )
              .limit(1);
      const current =
        existing === undefined
          ? null
          : {
              grantedTier: tierSchema.parse(existing.grantedTier),
              candidateTier:
                existing.candidateTier === null ? null : tierSchema.parse(existing.candidateTier),
              candidateSince: existing.candidateSince?.getTime() ?? null,
            };
      const resetCandidate = transferRows.length > 0;
      const next = advanceEntitlementState({
        current,
        eligibleTier,
        observedAt: block.timestamp.getTime(),
        minimumHoldingSeconds: config.minimumHoldingSeconds,
        resetCandidate,
      });
      const candidateChanged =
        next.candidateTier !== current?.candidateTier ||
        next.candidateSince !== current?.candidateSince ||
        resetCandidate;
      const status = next.grantedTier === eligibleTier ? 'available' : 'pending';
      return transaction
        .insert(schema.tokenEntitlementStates)
        .values({
          chainId: config.chainId,
          tokenAddress: config.tokenAddress.toLowerCase(),
          walletAddress: wallet.toLowerCase(),
          eligibleTier,
          grantedTier: next.grantedTier,
          candidateTier: next.candidateTier === 'free' ? null : next.candidateTier,
          candidateSince: next.candidateSince === null ? null : new Date(next.candidateSince),
          candidateStartBlock:
            next.candidateTier === null
              ? null
              : candidateChanged
                ? indexedBalance.asOfBlock
                : (candidateStartBlock ?? indexedBalance.asOfBlock),
          balanceRaw: directBalance.toString(),
          indexedBalanceRaw: indexedBalanceRaw.toString(),
          observedBlock: indexedBalance.asOfBlock,
          observedBlockHash: block.hash.toLowerCase(),
          status,
          reasons: status === 'pending' ? ['MINIMUM_HOLDING_DURATION_PENDING'] : [],
          methodologyVersion: config.version,
          observedAt: block.timestamp,
          expiresAt: new Date(this.now().getTime() + config.cacheSeconds * 1_000),
          updatedAt: this.now(),
        })
        .onConflictDoUpdate({
          target: [
            schema.tokenEntitlementStates.chainId,
            schema.tokenEntitlementStates.tokenAddress,
            schema.tokenEntitlementStates.walletAddress,
          ],
          set: {
            eligibleTier,
            grantedTier: next.grantedTier,
            candidateTier: next.candidateTier === 'free' ? null : next.candidateTier,
            candidateSince: next.candidateSince === null ? null : new Date(next.candidateSince),
            candidateStartBlock:
              next.candidateTier === null
                ? null
                : candidateChanged
                  ? indexedBalance.asOfBlock
                  : (candidateStartBlock ?? indexedBalance.asOfBlock),
            balanceRaw: directBalance.toString(),
            indexedBalanceRaw: indexedBalanceRaw.toString(),
            observedBlock: indexedBalance.asOfBlock,
            observedBlockHash: block.hash.toLowerCase(),
            status,
            reasons: status === 'pending' ? ['MINIMUM_HOLDING_DURATION_PENDING'] : [],
            methodologyVersion: config.version,
            observedAt: block.timestamp,
            expiresAt: new Date(this.now().getTime() + config.cacheSeconds * 1_000),
            updatedAt: this.now(),
          },
        })
        .returning();
    });
    const state = rows[0];
    if (state === undefined) throw new Error('TOKEN_ENTITLEMENT_UPSERT_FAILED');
    return this.view(state);
  }

  private unavailable(reason: string) {
    return {
      status: 'unavailable' as const,
      tier: 'free' as Tier,
      writeEnabled: false,
      reason,
      methodologyVersion: this.config.version,
    };
  }

  private view(row: typeof schema.tokenEntitlementStates.$inferSelect) {
    return {
      status: z.enum(['available', 'pending', 'unavailable']).parse(row.status),
      tier: tierSchema.parse(row.grantedTier),
      eligibleTier: tierSchema.parse(row.eligibleTier),
      balanceRaw: row.balanceRaw,
      observedBlock: row.observedBlock.toString(),
      observedBlockHash: row.observedBlockHash,
      candidateTier: row.candidateTier === null ? null : tierSchema.parse(row.candidateTier),
      candidateSince: row.candidateSince?.toISOString() ?? null,
      expiresAt: row.expiresAt.toISOString(),
      reasons: z.array(z.string()).parse(row.reasons),
      writeEnabled: row.status === 'available',
      methodologyVersion: row.methodologyVersion,
      verification: this.config.enabled
        ? {
            sourceUrl: this.config.verificationSourceUrl,
            verifiedAt: this.config.verifiedAt,
            runtimeBytecodeHash: this.config.runtimeBytecodeHash,
          }
        : null,
    };
  }
}
