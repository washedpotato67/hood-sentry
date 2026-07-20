import type { Logger } from '@hood-sentry/observability';

/**
 * Reads the pair registry a factory keeps on chain.
 *
 * Pools are otherwise learned only from creation events, so any pool created
 * before the indexer's current checkpoint is invisible to it. The factory knows
 * about all of them, and asking costs nothing but calls.
 */
export interface FactoryPairReader {
  totalPairs(): Promise<bigint>;
  pairAtIndex(index: bigint): Promise<`0x${string}`>;
  pairTokens(pairAddress: `0x${string}`): Promise<{
    token0: `0x${string}`;
    token1: `0x${string}`;
  }>;
}

export interface PoolBackfillStore {
  /** Lowercased addresses already indexed, so a rerun re-reads nothing. */
  knownPoolAddresses(): Promise<ReadonlySet<string>>;
  insertPools(
    rows: readonly { address: `0x${string}`; token0: string; token1: string }[],
  ): Promise<number>;
  readCursor(): Promise<number>;
  writeCursor(next: number): Promise<void>;
}

export interface PoolBackfillOptions {
  /** Pairs read per pass before progress is recorded. */
  batchSize: number;
}

/**
 * Walks a factory's pair registry and records the pools missing from the index.
 *
 * Progress is stored so an interrupted run resumes where it stopped: the
 * registry runs to tens of thousands of pairs, and restarting from zero each
 * time would spend the provider's budget re-reading what is already known.
 */
export class PoolBackfill {
  constructor(
    private readonly reader: FactoryPairReader,
    private readonly store: PoolBackfillStore,
    private readonly options: PoolBackfillOptions,
    private readonly logger: Pick<Logger, 'info' | 'warn'>,
  ) {}

  async run(): Promise<{ scanned: number; inserted: number }> {
    const total = Number(await this.reader.totalPairs());
    let cursor = await this.store.readCursor();
    if (cursor >= total) return { scanned: 0, inserted: 0 };

    const known = await this.store.knownPoolAddresses();
    let scanned = 0;
    let inserted = 0;

    while (cursor < total) {
      const end = Math.min(cursor + this.options.batchSize, total);
      const indexes: number[] = [];
      for (let index = cursor; index < end; index++) indexes.push(index);

      const rows: { address: `0x${string}`; token0: string; token1: string }[] = [];
      for (const index of indexes) {
        scanned += 1;
        try {
          const address = await this.reader.pairAtIndex(BigInt(index));
          if (known.has(address.toLowerCase())) continue;
          const tokens = await this.reader.pairTokens(address);
          rows.push({ address, token0: tokens.token0, token1: tokens.token1 });
        } catch (error) {
          // One unreadable pair must not end the walk: the rest of the registry
          // is still worth recovering, and the gap is visible in the logs.
          this.logger.warn('Skipping pair that could not be read', {
            index,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (rows.length > 0) inserted += await this.store.insertPools(rows);
      cursor = end;
      await this.store.writeCursor(cursor);
    }

    this.logger.info('Factory pair backfill finished', { total, scanned, inserted });
    return { scanned, inserted };
  }
}
