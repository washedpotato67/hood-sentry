import type { Database } from '@hood-sentry/db';
import { sql } from 'drizzle-orm';
import type { BackfilledPool, PoolBackfillStore } from './pool-backfill.js';

/**
 * Uniswap V2 pairs are constant-product with a fixed 0.3% fee, which is a
 * property of the protocol rather than of any individual pair, so it is not
 * something the backfill discovers.
 */
const POOL_TYPE = 'constantProduct';
const FEE_TIER = 3000;

/**
 * Records enumerated pools, and keeps the walk's position in the same
 * checkpoint table the indexer streams use, so a restart resumes rather than
 * re-reading tens of thousands of pairs.
 */
export class DrizzlePoolBackfillStore implements PoolBackfillStore {
  constructor(
    private readonly db: Database['db'],
    private readonly chainId: number,
    private readonly stream: string,
  ) {}

  async knownPoolAddresses(): Promise<ReadonlySet<string>> {
    const rows = await this.db.execute<{ address: string }>(
      sql`select lower(address) as address from pools where chain_id = ${this.chainId}`,
    );
    return new Set(rows.map((row) => row.address));
  }

  async insertPools(rows: readonly BackfilledPool[]): Promise<number> {
    if (rows.length === 0) return 0;
    let inserted = 0;
    for (const row of rows) {
      // The protocol is resolved from the factory that created the pair rather
      // than assumed, so a pair from a factory this deployment does not know is
      // skipped instead of filed under the wrong protocol.
      const result = await this.db.execute<{ address: string }>(sql`
        insert into pools (
          chain_id, address, protocol_id, token0_address, token1_address,
          fee_tier, created_block, created_tx_hash, created_block_hash,
          creation_log_index, active, canonical, pool_type,
          protocol_key, protocol_version, factory_address
        )
        select
          ${this.chainId}, ${row.address.toLowerCase()}, dex_protocols.id,
          ${row.token0.toLowerCase()}, ${row.token1.toLowerCase()},
          ${FEE_TIER}, ${row.createdBlock.toString()}::bigint, ${row.createdTxHash},
          ${row.createdBlockHash}, ${row.creationLogIndex}, true, true, ${POOL_TYPE},
          dex_protocols.protocol_key, dex_protocols.version, dex_protocols.factory_address
        from dex_protocols
        where dex_protocols.chain_id = ${this.chainId}
          and lower(dex_protocols.factory_address) = ${row.factoryAddress.toLowerCase()}
        on conflict do nothing
        returning address
      `);
      inserted += result.length;
    }
    return inserted;
  }

  async readCursor(): Promise<number> {
    const rows = await this.db.execute<{ next_block: string }>(
      sql`select next_block::text as next_block from indexer_checkpoints
          where chain_id = ${this.chainId} and stream = ${this.stream}`,
    );
    const value = rows[0]?.next_block;
    return value === undefined ? 0 : Number(value);
  }

  async writeCursor(next: number): Promise<void> {
    await this.db.execute(sql`
      insert into indexer_checkpoints (chain_id, stream, next_block, updated_at)
      values (${this.chainId}, ${this.stream}, ${next}, now())
      on conflict (chain_id, stream)
      do update set next_block = ${next}, updated_at = now()
    `);
  }
}
