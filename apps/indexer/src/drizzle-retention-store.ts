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

  async deleteOlderThan(table: string, beforeBlock: bigint, batchSize: number): Promise<number> {
    // ctid keeps the bounded delete cheap: the subquery picks a page-ordered
    // batch without needing to sort the whole matching set.
    const rows = await this.db.execute<{ ctid: string }>(
      sql`delete from ${sql.raw(`"${table}"`)}
          where ctid in (
            select ctid from ${sql.raw(`"${table}"`)}
            where chain_id = ${this.chainId} and block_number < ${beforeBlock}
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
