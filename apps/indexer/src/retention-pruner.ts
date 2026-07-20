import type { Logger } from '@hood-sentry/observability';

/**
 * Everything keyed to a block height that grows without bound, in the order it
 * must be deleted: a receipt references its transaction, so it goes first, and
 * blocks go last, after everything that describes them.
 *
 * `token_transfers` is derived rather than raw, but it is by far the largest
 * table and grows with chain activity, so it needs the same bound. The feeds
 * read only recent activity, and a transfer's provenance lives on the row
 * itself, so trimming old ones costs nothing the product serves.
 */
const PRUNABLE_TABLES = [
  'transaction_receipts',
  'transactions',
  'logs',
  'token_transfers',
  'discovery_snapshots',
  'blocks',
] as const;

export interface RetentionStore {
  /** Highest block number present in the indexed data, or null if there is none. */
  maxIndexedBlock(): Promise<bigint | null>;
  /**
   * Removes balances of zero. A wallet that sold everything holds nothing, so
   * the row records an absence; they are a fifth of the table and appear in no
   * holder list.
   */
  deleteZeroBalances(batchSize: number): Promise<number>;
  /**
   * Removes findings belonging to scans a later scan has replaced. Only the
   * latest canonical scan per token is ever read, so the rest are history of how
   * the analyzer once answered rather than evidence about the token now.
   */
  deleteSupersededFindings(batchSize: number): Promise<number>;
  /** Deletes up to a bounded batch below `beforeBlock`; returns rows removed. */
  deleteOlderThan(table: string, beforeBlock: bigint, batchSize: number): Promise<number>;
  /** Returns freed pages to the free space map so later writes can reuse them. */
  vacuum(table: string): Promise<void>;
}

export interface RetentionOptions {
  /**
   * How many blocks of raw facts to keep behind the indexed head. Zero disables
   * pruning entirely, which is the default: how much history to keep is an
   * operator's decision, not one to guess.
   */
  retentionBlocks: bigint;
  deleteBatchSize: number;
}

/**
 * Deletes raw chain facts that have fallen out of the retention window.
 *
 * Logs, transactions and receipts are intermediates: the worker derives token
 * transfers, discovery rankings and risk findings from them, and those derived
 * tables are what the product serves. Keeping every raw row forever is what
 * exhausted the database, and none of it is needed once it has been processed.
 */
export class RetentionPruner {
  constructor(
    private readonly store: RetentionStore,
    private readonly options: RetentionOptions,
    private readonly logger: Pick<Logger, 'info' | 'warn'>,
  ) {}

  async prune(): Promise<void> {
    if (this.options.retentionBlocks <= 0n) return;

    const head = await this.store.maxIndexedBlock();
    if (head === null) return;

    // Nothing has aged out yet on a chain shorter than the window.
    if (head <= this.options.retentionBlocks) return;
    const beforeBlock = head - this.options.retentionBlocks;

    for (const table of PRUNABLE_TABLES) {
      let removed = 0;
      try {
        // Bounded batches, repeated until a batch comes back short: a single
        // unbounded DELETE over months of rows would hold locks for minutes.
        while (true) {
          const batch = await this.store.deleteOlderThan(
            table,
            beforeBlock,
            this.options.deleteBatchSize,
          );
          removed += batch;
          if (batch < this.options.deleteBatchSize) break;
        }
      } catch (error) {
        this.logger.warn('Retention prune failed for table', {
          table,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      if (removed === 0) continue;

      this.logger.info('Pruned raw chain facts past retention', {
        table,
        removed,
        beforeBlock: beforeBlock.toString(),
      });

      try {
        await this.store.vacuum(table);
      } catch (error) {
        // Deleted rows are still gone; without the vacuum the space is simply
        // not reusable yet, and autovacuum will get to it.
        this.logger.warn('Vacuum after prune failed', {
          table,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await this.pruneRowsWithoutMeaning();
  }

  /**
   * Rows that carry no information regardless of age, so they are removed on the
   * same pass rather than kept until they fall out of the retention window.
   */
  private async pruneRowsWithoutMeaning(): Promise<void> {
    const cleanups = [
      { table: 'token_balances', run: () => this.store.deleteZeroBalances(this.batchSize) },
      { table: 'risk_findings', run: () => this.store.deleteSupersededFindings(this.batchSize) },
    ];

    for (const cleanup of cleanups) {
      let removed = 0;
      try {
        while (true) {
          const batch = await cleanup.run();
          removed += batch;
          if (batch < this.batchSize) break;
        }
      } catch (error) {
        this.logger.warn('Cleanup failed', {
          table: cleanup.table,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      if (removed === 0) continue;
      this.logger.info('Removed rows carrying no information', {
        table: cleanup.table,
        removed,
      });
      try {
        await this.store.vacuum(cleanup.table);
      } catch (error) {
        this.logger.warn('Vacuum after cleanup failed', {
          table: cleanup.table,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private get batchSize(): number {
    return this.options.deleteBatchSize;
  }
}
