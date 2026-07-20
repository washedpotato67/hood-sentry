import type { Database } from '@hood-sentry/db';
import { sql } from 'drizzle-orm';
import type { RetentionStore } from './retention-pruner.js';

/**
 * Table names are not user input: they come from a fixed list in the pruner, so
 * interpolating them into the statement is safe. Every value is still bound.
 */
export class DrizzleRetentionStore implements RetentionStore {
  constructor(
    private readonly db: Database['db'],
    private readonly chainId: bigint,
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
   * `blocks` itself calls that column `number`.
   */
  private blockColumn(table: string): string {
    if (table === 'blocks') return 'number';
    if (table === 'discovery_snapshots') return 'source_block_number';
    return 'block_number';
  }

  async deleteZeroBalances(batchSize: number): Promise<number> {
    const rows = await this.db.execute<{ ctid: string }>(
      sql`delete from token_balances
          where ctid in (
            select ctid from token_balances
            where chain_id = ${this.chainId} and balance_raw = 0
            limit ${batchSize}
          )
          returning ctid`,
    );
    return rows.length;
  }

  async deleteSupersededFindings(batchSize: number): Promise<number> {
    // Only the latest canonical scan per token is ever read back, so findings
    // attached to earlier runs describe how the analyzer once answered rather
    // than anything about the token now.
    const rows = await this.db.execute<{ ctid: string }>(
      sql`with latest as (
            select distinct on (target_address) id
            from risk_scan_runs
            where chain_id = ${this.chainId} and canonical = true
            order by target_address, created_at desc, id desc
          )
          delete from risk_findings
          where ctid in (
            select risk_findings.ctid from risk_findings
            where risk_findings.scan_run_id not in (select id from latest)
            limit ${batchSize}
          )
          returning ctid`,
    );
    return rows.length;
  }

  async deleteOlderThan(table: string, beforeBlock: bigint, batchSize: number): Promise<number> {
    // ctid keeps the bounded delete cheap: the subquery picks a page-ordered
    // batch without needing to sort the whole matching set.
    const rows = await this.db.execute<{ ctid: string }>(
      sql`delete from ${sql.raw(`"${table}"`)}
          where ctid in (
            select ctid from ${sql.raw(`"${table}"`)}
            where chain_id = ${this.chainId}
              and ${sql.raw(`"${this.blockColumn(table)}"`)} < ${beforeBlock}
            limit ${batchSize}
          )
          returning ctid`,
    );
    return rows.length;
  }

  async vacuum(table: string): Promise<void> {
    await this.db.execute(sql`vacuum ${sql.raw(`"${table}"`)}`);
  }
}
