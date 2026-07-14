import type { Database } from '@hood-sentry/db';
import type { Logger } from '@hood-sentry/observability';
import type { GapRange, IndexerConfig } from './types.js';

export class GapScanner {
  private readonly drizzle: Database['db'];

  constructor(
    database: Database,
    private readonly config: IndexerConfig,
    private readonly logger: Logger,
  ) {
    this.drizzle = database.db;
  }

  async scanForGaps(fromBlock: bigint, toBlock: bigint): Promise<GapRange[]> {
    this.logger.info('Scanning for gaps', {
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
    });

    const gaps: GapRange[] = [];

    const indexedBlocks = await this.drizzle.query.blocks.findMany({
      where: (blocks, { eq, and, gte, lte }) =>
        and(
          eq(blocks.chainId, this.config.chainId),
          gte(blocks.number, fromBlock),
          lte(blocks.number, toBlock),
          eq(blocks.canonical, true),
        ),
      columns: {
        number: true,
      },
      orderBy: (blocks, { asc }) => [asc(blocks.number)],
    });

    if (indexedBlocks.length === 0) {
      gaps.push({
        chainId: this.config.chainId,
        fromBlock,
        toBlock,
      });
      return gaps;
    }

    const indexedNumbers = new Set(indexedBlocks.map((b) => b.number));

    let gapStart: bigint | null = null;

    for (let blockNum = fromBlock; blockNum <= toBlock; blockNum++) {
      if (!indexedNumbers.has(blockNum)) {
        if (gapStart === null) {
          gapStart = blockNum;
        }
      } else {
        if (gapStart !== null) {
          gaps.push({
            chainId: this.config.chainId,
            fromBlock: gapStart,
            toBlock: blockNum - 1n,
          });
          gapStart = null;
        }
      }
    }

    if (gapStart !== null) {
      gaps.push({
        chainId: this.config.chainId,
        fromBlock: gapStart,
        toBlock,
      });
    }

    this.logger.info('Gap scan complete', {
      gapsFound: gaps.length,
      totalBlocks: Number(toBlock - fromBlock + 1n),
      indexedBlocks: indexedBlocks.length,
    });

    return gaps;
  }

  async getMissingBlocks(fromBlock: bigint, toBlock: bigint): Promise<bigint[]> {
    const indexedBlocks = await this.drizzle.query.blocks.findMany({
      where: (blocks, { eq, and, gte, lte }) =>
        and(
          eq(blocks.chainId, this.config.chainId),
          gte(blocks.number, fromBlock),
          lte(blocks.number, toBlock),
          eq(blocks.canonical, true),
        ),
      columns: {
        number: true,
      },
    });

    const indexedNumbers = new Set(indexedBlocks.map((b) => b.number));
    const missing: bigint[] = [];

    for (let blockNum = fromBlock; blockNum <= toBlock; blockNum++) {
      if (!indexedNumbers.has(blockNum)) {
        missing.push(blockNum);
      }
    }

    return missing;
  }

  async getGapStats(
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<{
    totalBlocks: number;
    indexedBlocks: number;
    missingBlocks: number;
    gapPercentage: number;
  }> {
    const totalBlocks = Number(toBlock - fromBlock + 1n);

    const indexedBlocks = await this.drizzle.query.blocks.findMany({
      where: (blocks, { eq, and, gte, lte }) =>
        and(
          eq(blocks.chainId, this.config.chainId),
          gte(blocks.number, fromBlock),
          lte(blocks.number, toBlock),
          eq(blocks.canonical, true),
        ),
      columns: {
        number: true,
      },
    });

    const indexedCount = indexedBlocks.length;
    const missingBlocks = totalBlocks - indexedCount;
    const gapPercentage = totalBlocks > 0 ? (missingBlocks / totalBlocks) * 100 : 0;

    return {
      totalBlocks,
      indexedBlocks: indexedCount,
      missingBlocks,
      gapPercentage,
    };
  }

  async findNextGap(afterBlock: bigint): Promise<GapRange | null> {
    const nextIndexed = await this.drizzle.query.blocks.findFirst({
      where: (blocks, { eq, and, gt }) =>
        and(
          eq(blocks.chainId, this.config.chainId),
          gt(blocks.number, afterBlock),
          eq(blocks.canonical, true),
        ),
      orderBy: (blocks, { asc }) => [asc(blocks.number)],
    });

    if (!nextIndexed) {
      return null;
    }

    const gapEnd = nextIndexed.number - 1n;

    if (gapEnd <= afterBlock) {
      return null;
    }

    return {
      chainId: this.config.chainId,
      fromBlock: afterBlock + 1n,
      toBlock: gapEnd,
    };
  }

  async getLargestGaps(limit = 10): Promise<GapRange[]> {
    const gaps = await this.scanForGaps(0n, await this.getLatestIndexedBlock());

    gaps.sort((a, b) => {
      const sizeA = Number(a.toBlock - a.fromBlock + 1n);
      const sizeB = Number(b.toBlock - b.fromBlock + 1n);
      return sizeB - sizeA;
    });

    return gaps.slice(0, limit);
  }

  private async getLatestIndexedBlock(): Promise<bigint> {
    const latestBlock = await this.drizzle.query.blocks.findFirst({
      where: (blocks, { eq }) => eq(blocks.chainId, this.config.chainId),
      orderBy: (blocks, { desc }) => [desc(blocks.number)],
    });

    return latestBlock?.number ?? 0n;
  }
}
