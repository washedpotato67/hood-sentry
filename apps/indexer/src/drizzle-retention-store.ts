import type { Database } from '@hood-sentry/db';
import { sql } from 'drizzle-orm';
import type { RetentionStore } from './retention-pruner.js';

/**
 * Table names are not user input: they come from a fixed list in the pruner, so
 * interpolating them into the statement is safe. Every value is still bound.
 *
 * Deletes are bounded by a window of blocks rather than by a row count. Limiting
 * a delete by rows requires PostgreSQL's `ctid` physical row pointer, which
 * other engines do not implement, and blocks are the natural ordering of this
 * data anyway. Where a table has no block to bound by, the bound is its primary
 * key, which every engine supports.
 */
export class DrizzleRetentionStore implements RetentionStore {
  constructor(
    private readonly db: Database['db'],
    private readonly chainId: number,
  ) {}

  async maxIndexedBlock(): Promise<bigint | null> {
    const rows = await this.db.execute<{ max: string | null }>(
      sql`select max(number)::text as max from blocks where chain_id = ${this.chainId}`,
    );
    const value = rows[0]?.max ?? null;
    return value === null ? null : BigInt(value);
  }

  /**
   * The fact tables record which block a row belongs to in `block_number`;
   * `blocks` itself calls that column `number`, and discovery snapshots record
   * the block they were derived from.
   */
  private blockColumn(table: string): string {
    if (table === 'blocks') return 'number';
    if (table === 'discovery_snapshots') return 'source_block_number';
    return 'block_number';
  }

  async deleteOlderThan(table: string, beforeBlock: bigint, batchSize: number): Promise<number> {
    const quoted = sql.raw(`"${table}"`);
    const column = sql.raw(`"${this.blockColumn(table)}"`);

    // Start each window at the oldest row still present, so a window always
    // contains rows if any remain and an empty result means the table is clear.
    const lowest = await this.db.execute<{ lowest: string | null }>(
      sql`select min(${column})::text as lowest from ${quoted}
          where chain_id = ${this.chainId} and ${column} < ${beforeBlock}`,
    );
    const from = lowest[0]?.lowest ?? null;
    if (from === null) return 0;

    const start = BigInt(from);
    const end = start + BigInt(batchSize) < beforeBlock ? start + BigInt(batchSize) : beforeBlock;

    const rows = await this.db.execute<{ chain_id: number }>(
      sql`delete from ${quoted}
          where chain_id = ${this.chainId}
            and ${column} >= ${start}
            and ${column} < ${end}
          returning chain_id`,
    );
    return rows.length;
  }

  async deleteZeroBalances(batchSize: number): Promise<number> {
    // Bounded by the table's own primary key rather than a row pointer.
    const rows = await this.db.execute<{ chain_id: number }>(
      sql`delete from token_balances
          where (chain_id, token_address, wallet_address) in (
            select chain_id, token_address, wallet_address from token_balances
            where chain_id = ${this.chainId} and balance_raw = 0
            limit ${batchSize}
          )
          returning chain_id`,
    );
    return rows.length;
  }

  async deleteSupersededFindings(batchSize: number): Promise<number> {
    // Only the latest canonical scan per token is ever read back, so findings
    // attached to earlier runs describe how the analyzer once answered rather
    // than anything about the token now.
    const rows = await this.db.execute<{ id: string }>(
      sql`with latest as (
            select distinct on (target_address) id
            from risk_scan_runs
            where chain_id = ${this.chainId} and canonical = true
            order by target_address, created_at desc, id desc
          )
          delete from risk_findings
          where id in (
            select id from risk_findings
            where scan_run_id not in (select id from latest)
            limit ${batchSize}
          )
          returning id`,
    );
    return rows.length;
  }

  async vacuum(table: string): Promise<void> {
    // Not every engine has an explicit vacuum; those that do not reclaim space
    // on their own. The pruner treats a failure here as non-fatal.
    await this.db.execute(sql`vacuum ${sql.raw(`"${table}"`)}`);
  }
}
