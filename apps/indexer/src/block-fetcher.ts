import type { RPCClient } from '@hood-sentry/chain';
import type { Logger } from '@hood-sentry/observability';
import type { Block, Hash, Log, Transaction, TransactionReceipt } from 'viem';
import type { BlockData, IndexerConfig } from './types.js';

export class BlockFetcher {
  constructor(
    private readonly rpcClient: RPCClient,
    private readonly config: IndexerConfig,
    private readonly logger: Logger,
  ) {}

  async fetchBlock(blockNumber: bigint): Promise<BlockData | null> {
    try {
      this.logger.debug('Fetching block', { blockNumber: blockNumber.toString() });

      const block = await this.rpcClient.getBlock({ blockNumber, includeTransactions: true });

      if (!block) {
        this.logger.warn('Block not found', { blockNumber: blockNumber.toString() });
        return null;
      }

      this.assertWellFormed(block, blockNumber.toString());

      const { transactions, receipts, logs } = await this.fetchBlockBodies(block);

      return {
        block,
        transactions,
        receipts,
        logs,
      };
    } catch (error) {
      this.logger.error('Failed to fetch block', {
        blockNumber: blockNumber.toString(),
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  /**
   * A response missing its identity fields is a provider defect, not an empty block.
   * Rejecting it here keeps callers from persisting nothing and advancing past the height.
   */
  private assertWellFormed(block: Block, reference: string): void {
    if (block.number === null || block.hash === null) {
      throw new Error(`Malformed RPC response for block ${reference}: missing number or hash`);
    }
  }

  /**
   * Receipts carry the logs, so a receipt that fails to load would silently yield a
   * block with missing logs. Fail the whole fetch instead and let the caller retry.
   */
  private async fetchBlockBodies(block: Block): Promise<{
    transactions: Transaction[];
    receipts: TransactionReceipt[];
    logs: Log[];
  }> {
    const transactions = block.transactions as Transaction[];

    if (transactions.length === 0) {
      return { transactions, receipts: [], logs: [] };
    }

    // One call for every receipt in the block. We pin it to the block hash so a
    // reorg between the getBlock and the receipt fetch surfaces as a mismatch
    // rather than silently mixing receipts from a different block.
    if (block.hash !== null) {
      try {
        const receipts = await this.rpcClient.getBlockReceipts({ blockHash: block.hash });
        if (receipts.length === transactions.length) {
          const logs = receipts.flatMap((receipt) => receipt.logs);
          return { transactions, receipts, logs };
        }
        this.logger.warn('Block receipts count mismatch, falling back to per-transaction fetch', {
          blockNumber: (block.number ?? 0n).toString(),
          expected: transactions.length,
          received: receipts.length,
        });
      } catch (error) {
        this.logger.warn(
          'eth_getBlockReceipts unavailable, falling back to per-transaction fetch',
          {
            blockNumber: (block.number ?? 0n).toString(),
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    return this.fetchBlockBodiesPerTransaction(transactions);
  }

  /**
   * Receipts carry the logs, so a receipt that fails to load would silently yield a
   * block with missing logs. Fail the whole fetch instead and let the caller retry.
   */
  private async fetchBlockBodiesPerTransaction(transactions: Transaction[]): Promise<{
    transactions: Transaction[];
    receipts: TransactionReceipt[];
    logs: Log[];
  }> {
    const receipts: TransactionReceipt[] = [];
    const logs: Log[] = [];

    for (const tx of transactions) {
      try {
        const receipt = await this.rpcClient.getTransactionReceipt(tx.hash);
        if (!receipt) {
          throw new Error('receipt not found');
        }
        receipts.push(receipt);
        logs.push(...receipt.logs);
      } catch (error) {
        this.logger.error('Failed to fetch receipt', {
          txHash: tx.hash,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error(
          `Failed to fetch receipt for ${tx.hash}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return { transactions, receipts, logs };
  }

  async fetchBlockByHash(blockHash: Hash): Promise<BlockData | null> {
    try {
      this.logger.debug('Fetching block by hash', { blockHash });

      const block = await this.rpcClient.getBlock({ blockHash, includeTransactions: true });

      if (!block) {
        this.logger.warn('Block not found', { blockHash });
        return null;
      }

      this.assertWellFormed(block, blockHash);

      const { transactions, receipts, logs } = await this.fetchBlockBodies(block);

      return {
        block,
        transactions,
        receipts,
        logs,
      };
    } catch (error) {
      this.logger.error('Failed to fetch block by hash', {
        blockHash,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  async fetchBlockRange(fromBlock: bigint, toBlock: bigint): Promise<BlockData[]> {
    const blocks: BlockData[] = [];
    const batchSize = this.config.batchSize;

    for (let i = fromBlock; i <= toBlock; i += BigInt(batchSize)) {
      const batchEnd = i + BigInt(batchSize) - 1n;
      const actualEnd = batchEnd > toBlock ? toBlock : batchEnd;

      this.logger.info('Fetching block range', {
        fromBlock: i.toString(),
        toBlock: actualEnd.toString(),
      });

      for (let blockNum = i; blockNum <= actualEnd; blockNum++) {
        const blockData = await this.fetchBlock(blockNum);
        if (blockData) {
          blocks.push(blockData);
        }
      }
    }

    return blocks;
  }

  /**
   * Fetch a contiguous window of blocks, returned in ascending order, with at
   * most `concurrency` fetches in flight. Used by live catch-up to drain a
   * finalized backlog faster than the strictly-sequential {@link fetchBlockRange}
   * without flooding a rate-limited provider. A hole (a null within the window)
   * truncates the result at the gap so the caller never advances past a block it
   * failed to fetch.
   */
  async fetchBlockWindow(
    fromBlock: bigint,
    toBlock: bigint,
    concurrency: number,
  ): Promise<BlockData[]> {
    const numbers: bigint[] = [];
    for (let n = fromBlock; n <= toBlock; n++) {
      numbers.push(n);
    }

    const results: (BlockData | null)[] = new Array(numbers.length).fill(null);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        const index = cursor++;
        const blockNumber = numbers[index];
        if (blockNumber === undefined) return;
        results[index] = await this.fetchBlock(blockNumber);
      }
    };

    const workerCount = Math.max(1, Math.min(concurrency, numbers.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    const blocks: BlockData[] = [];
    for (const blockData of results) {
      if (!blockData) break;
      blocks.push(blockData);
    }

    return blocks;
  }

  /**
   * Fetch a window as one `eth_getLogs` call plus one header per block, instead
   * of a body and a receipt set per block. The provider's free tier meters HTTP
   * requests, and this path spends roughly two requests per ten blocks rather
   * than twenty, which is what lets live indexing outrun the chain.
   *
   * The returned blocks carry no transactions or receipts: this path reads the
   * event log only. Callers that need per-transaction data must backfill it
   * separately. As with {@link fetchBlockWindow}, a hole truncates the result so
   * the caller never advances past a block it failed to read.
   */
  async fetchLogWindow(fromBlock: bigint, toBlock: bigint): Promise<BlockData[]> {
    const numbers: bigint[] = [];
    for (let n = fromBlock; n <= toBlock; n++) {
      numbers.push(n);
    }

    const [logs, headers] = await Promise.all([
      this.rpcClient.getLogs({ fromBlock, toBlock }),
      Promise.all(
        numbers.map((blockNumber) =>
          this.rpcClient.getBlock({ blockNumber, includeTransactions: false }),
        ),
      ),
    ]);

    const logsByBlock = new Map<bigint, Log[]>();
    for (const entry of logs) {
      if (entry.blockNumber === null) continue;
      const existing = logsByBlock.get(entry.blockNumber);
      if (existing) {
        existing.push(entry);
      } else {
        logsByBlock.set(entry.blockNumber, [entry]);
      }
    }

    const blocks: BlockData[] = [];
    for (const [index, block] of headers.entries()) {
      const blockNumber = numbers[index];
      if (!block || blockNumber === undefined) break;
      this.assertWellFormed(block, blockNumber.toString());
      blocks.push({
        block,
        transactions: [],
        receipts: [],
        logs: logsByBlock.get(blockNumber) ?? [],
      });
    }

    return blocks;
  }

  async validateParentHash(block: Block, expectedParentHash: Hash | null): Promise<boolean> {
    if (!expectedParentHash) {
      return true;
    }

    if (block.parentHash !== expectedParentHash) {
      this.logger.warn('Parent hash mismatch - reorg detected', {
        blockNumber: (block.number ?? 0n).toString(),
        expectedParentHash,
        actualParentHash: block.parentHash,
      });
      return false;
    }

    return true;
  }

  async getLatestBlockNumber(): Promise<bigint> {
    const blockNumber = await this.rpcClient.getBlockNumber();
    return blockNumber;
  }

  async getFinalizedBlockNumber(): Promise<bigint> {
    return this.getLatestBlockNumber();
  }

  async getSafeBlockNumber(): Promise<bigint> {
    return this.getLatestBlockNumber();
  }
}
