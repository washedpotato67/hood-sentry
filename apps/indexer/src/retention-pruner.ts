import type { Logger } from '@hood-sentry/observability';

/**
 * Raw chain facts, in the order they must be deleted: a receipt references its
 * transaction, so it goes first. Logs no longer reference transactions and are
 * independent.
 */
const PRUNABLE_TABLES = ['transaction_receipts', 'transactions', 'logs'] as const;

export interface RetentionStore {
  /** Highest block number present in the indexed data, or null if there is none. */
  maxIndexedBlock(): Promise<bigint | null>;
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
  }
}
