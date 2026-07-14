import type { Database } from '@hood-sentry/db';
import { schema } from '@hood-sentry/db';
import type { Logger } from '@hood-sentry/observability';
import { and, eq, gte, lte } from 'drizzle-orm';
import type { Hash } from 'viem';
import type { BlockFetcher } from './block-fetcher.js';
import type { IndexerConfig, ReorgEvent } from './types.js';

export class ReorgDetector {
  private readonly drizzle: Database['db'];

  constructor(
    database: Database,
    private readonly blockFetcher: BlockFetcher,
    private readonly config: IndexerConfig,
    private readonly logger: Logger,
  ) {
    this.drizzle = database.db;
  }

  async detectReorg(
    blockNumber: bigint,
    expectedParentHash: Hash | null,
    actualParentHash: Hash,
  ): Promise<ReorgEvent | null> {
    if (!expectedParentHash) {
      return null;
    }

    if (expectedParentHash === actualParentHash) {
      return null;
    }

    this.logger.warn('Reorg detected', {
      blockNumber: blockNumber.toString(),
      expectedParentHash,
      actualParentHash,
    });

    const commonAncestor = await this.findCommonAncestor(blockNumber - 1n);

    if (!commonAncestor) {
      this.logger.error('Failed to find common ancestor');
      return null;
    }

    const blocksOrphaned = Number(blockNumber - commonAncestor.blockNumber - 1n);

    const reorgEvent = await this.recordReorgEvent(
      commonAncestor.blockNumber + 1n,
      blockNumber - 1n,
      commonAncestor.blockNumber,
      blocksOrphaned,
    );

    return reorgEvent;
  }

  private async findCommonAncestor(
    startBlock: bigint,
  ): Promise<{ blockNumber: bigint; hash: Hash } | null> {
    let currentBlock = startBlock;

    while (currentBlock > 0n) {
      const dbBlock = await this.drizzle.query.blocks.findFirst({
        where: (blocks, { eq, and }) =>
          and(
            eq(blocks.chainId, this.config.chainId),
            eq(blocks.number, currentBlock),
            eq(blocks.canonical, true),
          ),
      });

      if (!dbBlock) {
        currentBlock -= 1n;
        continue;
      }

      const chainBlock = await this.blockFetcher.fetchBlock(currentBlock);

      if (!chainBlock) {
        currentBlock -= 1n;
        continue;
      }

      if (dbBlock.hash === chainBlock.block.hash) {
        this.logger.info('Found common ancestor', {
          blockNumber: currentBlock.toString(),
          hash: dbBlock.hash,
        });
        return {
          blockNumber: currentBlock,
          hash: dbBlock.hash as Hash,
        };
      }

      currentBlock -= 1n;
    }

    return null;
  }

  async handleReorg(reorgEvent: ReorgEvent): Promise<void> {
    this.logger.info('Handling reorg', {
      fromBlock: reorgEvent.fromBlock.toString(),
      toBlock: reorgEvent.toBlock.toString(),
      commonAncestor: reorgEvent.commonAncestorBlock.toString(),
      blocksOrphaned: reorgEvent.blocksOrphaned,
    });

    await this.markBlocksOrphaned(reorgEvent.fromBlock, reorgEvent.toBlock);
    await this.markTransactionsOrphaned(reorgEvent.fromBlock, reorgEvent.toBlock);
    await this.markLogsOrphaned(reorgEvent.fromBlock, reorgEvent.toBlock);
    await this.resolveReorgEvent(reorgEvent.id);

    this.logger.info('Reorg handled successfully', {
      reorgEventId: reorgEvent.id.toString(),
    });
  }

  private async markBlocksOrphaned(fromBlock: bigint, toBlock: bigint): Promise<void> {
    await this.drizzle
      .update(schema.blocks)
      .set({ canonical: false, finalityState: 'orphaned' })
      .where(
        and(
          eq(schema.blocks.chainId, this.config.chainId),
          gte(schema.blocks.number, fromBlock),
          lte(schema.blocks.number, toBlock),
          eq(schema.blocks.canonical, true),
        ),
      );
  }

  private async markTransactionsOrphaned(fromBlock: bigint, toBlock: bigint): Promise<void> {
    await this.drizzle
      .update(schema.transactions)
      .set({ canonical: false })
      .where(
        and(
          eq(schema.transactions.chainId, this.config.chainId),
          gte(schema.transactions.blockNumber, fromBlock),
          lte(schema.transactions.blockNumber, toBlock),
          eq(schema.transactions.canonical, true),
        ),
      );
  }

  private async markLogsOrphaned(fromBlock: bigint, toBlock: bigint): Promise<void> {
    await this.drizzle
      .update(schema.logs)
      .set({ canonical: false, removed: true })
      .where(
        and(
          eq(schema.logs.chainId, this.config.chainId),
          gte(schema.logs.blockNumber, fromBlock),
          lte(schema.logs.blockNumber, toBlock),
          eq(schema.logs.canonical, true),
        ),
      );
  }

  private async recordReorgEvent(
    fromBlock: bigint,
    toBlock: bigint,
    commonAncestorBlock: bigint,
    blocksOrphaned: number,
  ): Promise<ReorgEvent> {
    const result = await this.drizzle
      .insert(schema.reorgEvents)
      .values({
        chainId: this.config.chainId,
        fromBlock,
        toBlock,
        commonAncestorBlock,
        blocksOrphaned,
        detectedAt: new Date(),
      })
      .returning();

    const event = result[0];
    if (!event) {
      throw new Error('Failed to record reorg event');
    }

    return {
      id: event.id,
      chainId: event.chainId,
      fromBlock: event.fromBlock,
      toBlock: event.toBlock,
      commonAncestorBlock: event.commonAncestorBlock,
      blocksOrphaned: event.blocksOrphaned,
      detectedAt: event.detectedAt,
      resolvedAt: event.resolvedAt,
    };
  }

  private async resolveReorgEvent(reorgEventId: bigint): Promise<void> {
    await this.drizzle
      .update(schema.reorgEvents)
      .set({ resolvedAt: new Date() })
      .where(eq(schema.reorgEvents.id, reorgEventId));
  }

  async getUnresolvedReorgs(): Promise<ReorgEvent[]> {
    const results = await this.drizzle.query.reorgEvents.findMany({
      where: (reorgEvents, { eq, and, isNull }) =>
        and(eq(reorgEvents.chainId, this.config.chainId), isNull(reorgEvents.resolvedAt)),
    });

    return results.map((event) => ({
      id: event.id,
      chainId: event.chainId,
      fromBlock: event.fromBlock,
      toBlock: event.toBlock,
      commonAncestorBlock: event.commonAncestorBlock,
      blocksOrphaned: event.blocksOrphaned,
      detectedAt: event.detectedAt,
      resolvedAt: event.resolvedAt,
    }));
  }
}
