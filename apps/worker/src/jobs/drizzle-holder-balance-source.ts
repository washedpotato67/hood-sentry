import { type Database, schema } from '@hood-sentry/db';
import { and, desc, eq, gt, lte, or } from 'drizzle-orm';
import type { HolderBalanceSource, IndexedBalance } from './holder-distribution-context.js';

/** Reads holder evidence from the indexer's own tables. */
export class DrizzleHolderBalanceSource implements HolderBalanceSource {
  constructor(private readonly database: Database) {}

  async listBalances(chainId: number, tokenAddress: string): Promise<readonly IndexedBalance[]> {
    const rows = await this.database.db
      .select({
        address: schema.tokenBalances.wallet_address,
        balanceRaw: schema.tokenBalances.balance_raw,
        asOfBlock: schema.tokenBalances.as_of_block,
      })
      .from(schema.tokenBalances)
      .where(
        and(
          eq(schema.tokenBalances.chain_id, chainId),
          eq(schema.tokenBalances.token_address, tokenAddress.toLowerCase()),
          gt(schema.tokenBalances.balance_raw, '0'),
        ),
      );

    return rows.map((row) => ({
      address: row.address as `0x${string}`,
      balanceRaw: BigInt(row.balanceRaw),
      asOfBlock: row.asOfBlock,
    }));
  }

  async latestTransferBlock(
    chainId: number,
    tokenAddress: string,
    atBlock: bigint,
  ): Promise<bigint | null> {
    const rows = await this.database.db
      .select({ blockNumber: schema.tokenTransfers.block_number })
      .from(schema.tokenTransfers)
      .where(
        and(
          eq(schema.tokenTransfers.chain_id, chainId),
          eq(schema.tokenTransfers.token_address, tokenAddress.toLowerCase()),
          lte(schema.tokenTransfers.block_number, atBlock),
        ),
      )
      .orderBy(desc(schema.tokenTransfers.block_number))
      .limit(1);

    return rows[0]?.blockNumber ?? null;
  }

  async totalSupply(chainId: number, tokenAddress: string): Promise<bigint | null> {
    const rows = await this.database.db
      .select({ totalSupplyRaw: schema.tokens.total_supply_raw })
      .from(schema.tokens)
      .where(
        and(
          eq(schema.tokens.chain_id, chainId),
          eq(schema.tokens.address, tokenAddress.toLowerCase()),
        ),
      )
      .limit(1);

    const raw = rows[0]?.totalSupplyRaw;
    return raw === null || raw === undefined ? null : BigInt(raw);
  }

  async listPoolAddresses(
    chainId: number,
    tokenAddress: string,
  ): Promise<readonly `0x${string}`[]> {
    const token = tokenAddress.toLowerCase();
    const rows = await this.database.db
      .select({ address: schema.pools.address })
      .from(schema.pools)
      .where(
        and(
          eq(schema.pools.chain_id, chainId),
          eq(schema.pools.canonical, true),
          or(eq(schema.pools.token0_address, token), eq(schema.pools.token1_address, token)),
        ),
      );

    return rows.map((row) => row.address as `0x${string}`);
  }
}
