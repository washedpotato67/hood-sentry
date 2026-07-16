import type { Database } from '@hood-sentry/db';
import type { Logger } from '@hood-sentry/observability';
import { type DerivedJobPublisher, derivedJobIdempotencyKey } from '@hood-sentry/queue';
import type { BlockFetcher } from './block-fetcher.js';
import type { BlockPersister } from './block-persister.js';
import type { CheckpointManager } from './checkpoint-manager.js';
import type { GapScanner } from './gap-scanner.js';
import type { ProtocolEventsHandler } from './handlers/protocol-events.js';
import type { ReorgDetector } from './reorg-detector.js';
import { TokenDiscoveryHandler } from './token-discovery-handler.js';
import type {
  BlockData,
  DerivedJob,
  FinalityState,
  IndexerConfig,
  IndexerMetrics,
  IndexerStatus,
} from './types.js';

type DrizzleDB = Database['db'];

export class BlockIndexer {
  private readonly drizzle: DrizzleDB;
  private readonly tokenDiscoveryHandler: TokenDiscoveryHandler;
  private running = false;
  private paused = false;
  private metrics: IndexerMetrics = {
    blocksIndexed: 0,
    transactionsIndexed: 0,
    logsIndexed: 0,
    reorgsDetected: 0,
    gapsFound: 0,
    lastBlockNumber: null,
    lastBlockTimestamp: null,
    avgBlockTimeMs: 0,
    lag: 0,
  };
  private errors: Array<{
    timestamp: Date;
    blockNumber: bigint | null;
    error: string;
    retryCount: number;
  }> = [];

  constructor(
    database: Database,
    private readonly checkpointManager: CheckpointManager,
    private readonly blockFetcher: BlockFetcher,
    private readonly blockPersister: BlockPersister,
    private readonly reorgDetector: ReorgDetector,
    private readonly gapScanner: GapScanner,
    private readonly config: IndexerConfig,
    private readonly logger: Logger,
    private readonly protocolEventsHandler?: ProtocolEventsHandler,
    private readonly jobPublisher?: DerivedJobPublisher,
  ) {
    this.drizzle = database.db;
    this.tokenDiscoveryHandler = new TokenDiscoveryHandler(this.config, this.logger);
  }

  async start(): Promise<void> {
    if (this.running) {
      this.logger.warn('Indexer already running');
      return;
    }

    this.running = true;
    this.paused = false;

    this.logger.info('Starting indexer', {
      mode: this.config.mode,
      chainId: this.config.chainId.toString(),
      workerId: this.config.workerId,
    });

    try {
      switch (this.config.mode) {
        case 'live':
          await this.runLiveMode();
          break;
        case 'historical':
          await this.runHistoricalMode();
          break;
        case 'gap-repair':
          await this.runGapRepairMode();
          break;
        case 'reorg-reconciliation':
          await this.runReorgReconciliationMode();
          break;
        case 'contract-replay':
          await this.runContractReplayMode();
          break;
        default:
          throw new Error(`Unknown indexer mode: ${this.config.mode}`);
      }
    } catch (error) {
      this.logger.error('Indexer error', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    } finally {
      this.running = false;
    }
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping indexer');
    this.running = false;
    this.paused = true;

    await this.checkpointManager.releaseLease(this.getStreamName());

    this.logger.info('Indexer stopped');
  }

  pause(): void {
    this.paused = true;
    this.logger.info('Indexer paused');
  }

  resume(): void {
    this.paused = false;
    this.logger.info('Indexer resumed');
  }

  getStatus(): IndexerStatus {
    return {
      mode: this.config.mode,
      running: this.running,
      paused: this.paused,
      currentBlock: this.metrics.lastBlockNumber,
      targetBlock: this.config.endBlock ?? null,
      metrics: { ...this.metrics },
      errors: [...this.errors],
    };
  }

  private async runLiveMode(): Promise<void> {
    const streamName = this.getStreamName();

    const lease = await this.checkpointManager.acquireLease(streamName);
    if (!lease) {
      throw new Error('Failed to acquire lease - another indexer may be running');
    }

    this.logger.info('Lease acquired', { streamName, workerId: this.config.workerId });

    let checkpoint = await this.checkpointManager.getCheckpoint(streamName);
    if (!checkpoint) {
      const startBlock = this.config.startBlock ?? 0n;
      checkpoint = await this.checkpointManager.createOrUpdateCheckpoint(
        streamName,
        startBlock,
        null,
      );
      this.logger.info('Created initial checkpoint', { startBlock: startBlock.toString() });
    }

    let currentBlock = checkpoint.nextBlock;
    let lastBlockHash = checkpoint.lastBlockHash;

    while (this.running && !this.paused) {
      try {
        const renewed = await this.checkpointManager.renewLease(streamName);
        if (!renewed) {
          this.logger.error('Failed to renew lease');
          break;
        }

        const latestBlock = await this.blockFetcher.getLatestBlockNumber();
        this.metrics.lag = Number(latestBlock - currentBlock);

        if (currentBlock > latestBlock) {
          await this.sleep(this.config.pollIntervalMs);
          continue;
        }

        const blockData = await this.blockFetcher.fetchBlock(currentBlock);
        if (!blockData) {
          this.logger.warn('Block not found, retrying', { blockNumber: currentBlock.toString() });
          await this.sleep(this.config.retryDelayMs);
          continue;
        }

        const isValid = await this.blockFetcher.validateParentHash(blockData.block, lastBlockHash);
        if (!isValid) {
          const reorgEvent = await this.reorgDetector.detectReorg(
            currentBlock,
            lastBlockHash,
            blockData.block.parentHash,
          );

          if (reorgEvent) {
            this.metrics.reorgsDetected++;
            await this.reorgDetector.handleReorg(reorgEvent);

            currentBlock = reorgEvent.commonAncestorBlock + 1n;
            lastBlockHash = null;
            continue;
          }
        }

        const finalityState = await this.determineFinalityState(currentBlock);

        await this.blockPersister.persistBlockData(blockData, finalityState, true);

        await this.checkpointManager.createOrUpdateCheckpoint(
          streamName,
          currentBlock + 1n,
          blockData.block.hash,
        );

        this.metrics.blocksIndexed++;
        this.metrics.transactionsIndexed += blockData.transactions.length;
        this.metrics.logsIndexed += blockData.logs.length;
        this.metrics.lastBlockNumber = currentBlock;
        this.metrics.lastBlockTimestamp = new Date(Number(blockData.block.timestamp) * 1000);

        this.logger.info('Block indexed', {
          blockNumber: currentBlock.toString(),
          blockHash: blockData.block.hash,
          transactions: blockData.transactions.length,
          logs: blockData.logs.length,
          finalityState,
          lag: this.metrics.lag,
        });

        await this.publishDerivedJobs(blockData);

        currentBlock++;
        lastBlockHash = blockData.block.hash;
      } catch (error) {
        this.handleError(error, currentBlock);
        await this.sleep(this.config.retryDelayMs);
      }
    }

    await this.checkpointManager.releaseLease(streamName);
  }

  private async runHistoricalMode(): Promise<void> {
    if (this.config.startBlock === undefined || this.config.endBlock === undefined) {
      throw new Error('Historical mode requires startBlock and endBlock');
    }

    const streamName = this.getStreamName();

    const lease = await this.checkpointManager.acquireLease(streamName);
    if (!lease) {
      throw new Error('Failed to acquire lease');
    }

    let currentBlock = this.config.startBlock;
    const endBlock = this.config.endBlock;

    this.logger.info('Starting historical backfill', {
      startBlock: currentBlock.toString(),
      endBlock: endBlock.toString(),
    });

    while (this.running && !this.paused && currentBlock <= endBlock) {
      try {
        await this.checkpointManager.renewLease(streamName);

        const batchEnd = currentBlock + BigInt(this.config.batchSize) - 1n;
        const actualEnd = batchEnd > endBlock ? endBlock : batchEnd;

        const blocks = await this.blockFetcher.fetchBlockRange(currentBlock, actualEnd);

        for (const blockData of blocks) {
          if (!this.running || this.paused) break;

          const blockNumber = blockData.block.number;
          if (blockNumber === null) continue;

          const finalityState = await this.determineFinalityState(blockNumber);
          await this.blockPersister.persistBlockData(blockData, finalityState, true);

          this.metrics.blocksIndexed++;
          this.metrics.transactionsIndexed += blockData.transactions.length;
          this.metrics.logsIndexed += blockData.logs.length;
          this.metrics.lastBlockNumber = blockNumber;

          await this.publishDerivedJobs(blockData);
        }

        currentBlock = actualEnd + 1n;

        this.logger.info('Historical backfill progress', {
          currentBlock: currentBlock.toString(),
          endBlock: endBlock.toString(),
          progress: `${((Number(currentBlock - this.config.startBlock) / Number(endBlock - this.config.startBlock + 1n)) * 100).toFixed(2)}%`,
        });
      } catch (error) {
        this.handleError(error, currentBlock);
        await this.sleep(this.config.retryDelayMs);
      }
    }

    await this.checkpointManager.releaseLease(streamName);
  }

  private async runGapRepairMode(): Promise<void> {
    const streamName = this.getStreamName();

    const lease = await this.checkpointManager.acquireLease(streamName);
    if (!lease) {
      throw new Error('Failed to acquire lease');
    }

    const startBlock = this.config.startBlock ?? 0n;
    const endBlock = this.config.endBlock ?? (await this.blockFetcher.getLatestBlockNumber());

    this.logger.info('Starting gap repair', {
      startBlock: startBlock.toString(),
      endBlock: endBlock.toString(),
    });

    const gaps = await this.gapScanner.scanForGaps(startBlock, endBlock);
    this.metrics.gapsFound = gaps.length;

    this.logger.info('Gaps found', { count: gaps.length });

    for (const gap of gaps) {
      if (!this.running || this.paused) break;

      this.logger.info('Repairing gap', {
        fromBlock: gap.fromBlock.toString(),
        toBlock: gap.toBlock.toString(),
      });

      const blocks = await this.blockFetcher.fetchBlockRange(gap.fromBlock, gap.toBlock);

      for (const blockData of blocks) {
        if (!this.running || this.paused) break;

        const blockNumber = blockData.block.number;
        if (blockNumber === null) continue;

        const finalityState = await this.determineFinalityState(blockNumber);
        await this.blockPersister.persistBlockData(blockData, finalityState, true);

        this.metrics.blocksIndexed++;
        this.metrics.transactionsIndexed += blockData.transactions.length;
        this.metrics.logsIndexed += blockData.logs.length;

        await this.publishDerivedJobs(blockData);
      }
    }

    await this.checkpointManager.releaseLease(streamName);
  }

  private async runReorgReconciliationMode(): Promise<void> {
    const streamName = this.getStreamName();

    const lease = await this.checkpointManager.acquireLease(streamName);
    if (!lease) {
      throw new Error('Failed to acquire lease');
    }

    const unresolvedReorgs = await this.reorgDetector.getUnresolvedReorgs();

    this.logger.info('Unresolved reorgs', { count: unresolvedReorgs.length });

    for (const reorg of unresolvedReorgs) {
      if (!this.running || this.paused) break;

      this.logger.info('Reconciling reorg', {
        reorgId: reorg.id.toString(),
        fromBlock: reorg.fromBlock.toString(),
        toBlock: reorg.toBlock.toString(),
      });

      await this.reorgDetector.handleReorg(reorg);
    }

    await this.checkpointManager.releaseLease(streamName);
  }

  private async runContractReplayMode(): Promise<void> {
    if (!this.config.targetContracts || this.config.targetContracts.length === 0) {
      throw new Error('Contract replay mode requires targetContracts');
    }

    const targetContracts = this.config.targetContracts;
    const streamName = this.getStreamName();

    const lease = await this.checkpointManager.acquireLease(streamName);
    if (!lease) {
      throw new Error('Failed to acquire lease');
    }

    const startBlock = this.config.startBlock ?? 0n;
    const endBlock = this.config.endBlock ?? (await this.blockFetcher.getLatestBlockNumber());

    this.logger.info('Starting contract replay', {
      contracts: this.config.targetContracts,
      startBlock: startBlock.toString(),
      endBlock: endBlock.toString(),
    });

    const logs = await this.drizzle.query.logs.findMany({
      where: (logs, { eq, and, gte, lte, inArray }) =>
        and(
          eq(logs.chainId, this.config.chainId),
          gte(logs.blockNumber, startBlock),
          lte(logs.blockNumber, endBlock),
          inArray(logs.address, targetContracts),
          eq(logs.canonical, true),
        ),
      orderBy: (logs, { asc }) => [asc(logs.blockNumber), asc(logs.logIndex)],
    });

    this.logger.info('Logs found for replay', { count: logs.length });

    const batchSize = this.config.batchSize;
    for (let i = 0; i < logs.length; i += batchSize) {
      if (!this.running || this.paused) break;

      const batch = logs.slice(i, i + batchSize);

      for (const log of batch) {
        if (log.transactionIndex === null) {
          this.logger.warn('Skipping legacy replay log with missing transaction index', {
            transactionHash: log.transactionHash,
            logIndex: log.logIndex,
          });
          continue;
        }
        await this.protocolEventsHandler?.handle({
          chainId: Number(log.chainId),
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          transactionHash: log.transactionHash,
          transactionIndex: log.transactionIndex,
          logIndex: log.logIndex,
          address: log.address,
          topics: [log.topic0, log.topic1, log.topic2, log.topic3].filter(
            (topic): topic is string => topic !== null,
          ),
          data: log.data,
          removed: log.removed,
          canonical: log.canonical,
        });
      }

      this.logger.info('Contract replay progress', {
        processed: Math.min(i + batchSize, logs.length),
        total: logs.length,
      });
    }

    await this.checkpointManager.releaseLease(streamName);
  }

  private async determineFinalityState(blockNumber: bigint): Promise<FinalityState> {
    const latestBlock = await this.blockFetcher.getLatestBlockNumber();
    const confirmations = latestBlock - blockNumber;

    if (confirmations >= BigInt(this.config.finalityConfirmations)) {
      return 'finalized';
    }

    if (confirmations >= BigInt(this.config.safeConfirmations)) {
      return 'safe';
    }

    if (confirmations > 0n) {
      return 'soft_confirmed';
    }

    return 'pending';
  }

  private async publishDerivedJobs(blockData: BlockData): Promise<void> {
    const block = blockData.block;
    if (block.number === null || block.hash === null) {
      this.logger.warn('Skipping derived jobs for block with missing number or hash');
      return;
    }

    for (const log of blockData.logs) {
      await this.protocolEventsHandler?.handle({
        chainId: Number(this.config.chainId),
        blockNumber: block.number,
        blockHash: block.hash,
        transactionHash: log.transactionHash,
        transactionIndex: log.transactionIndex,
        logIndex: log.logIndex,
        address: log.address,
        topics: log.topics,
        data: log.data,
        removed: log.removed,
        canonical: !log.removed,
      });
    }

    // Use token discovery handler to detect contracts and tokens
    const discoveryJobs = this.tokenDiscoveryHandler.detectNewContractsAndTokens(blockData);
    for (const job of discoveryJobs) {
      await this.publishJob(job);
    }
  }

  private async publishJob(job: DerivedJob): Promise<void> {
    this.logger.debug('Publishing derived job', {
      type: job.type,
      blockNumber: job.blockNumber.toString(),
    });
    if (this.jobPublisher === undefined) return;
    const transactionHash =
      typeof job.data.transactionHash === 'string' ? job.data.transactionHash : undefined;
    const logIndex = typeof job.data.logIndex === 'number' ? job.data.logIndex : undefined;
    const idempotencyKey = derivedJobIdempotencyKey({
      type: job.type,
      chainId: job.chainId,
      blockHash: job.blockHash,
      transactionHash,
      logIndex,
    });
    await this.jobPublisher.publish(job, idempotencyKey);
  }

  private handleError(error: unknown, blockNumber: bigint | null): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    this.logger.error('Indexer error', {
      blockNumber: blockNumber?.toString(),
      error: errorMessage,
      stack: errorStack,
    });

    this.errors.push({
      timestamp: new Date(),
      blockNumber,
      error: errorMessage,
      retryCount: 0,
    });

    if (this.errors.length > 100) {
      this.errors = this.errors.slice(-100);
    }
  }

  private getStreamName(): string {
    return `${this.config.mode}-${this.config.chainId.toString()}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
