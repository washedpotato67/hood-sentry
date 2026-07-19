import type { RPCClient } from '@hood-sentry/chain';
import type { Logger } from '@hood-sentry/observability';
import type { Block, Log } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { BlockFetcher } from './block-fetcher.js';
import type { IndexerConfig } from './types.js';

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

const config = { chainId: 4663n, batchSize: 10 } as unknown as IndexerConfig;

function header(blockNumber: bigint): Block {
  return {
    number: blockNumber,
    hash: `0x${blockNumber.toString(16).padStart(64, '0')}` as `0x${string}`,
    parentHash: `0x${(blockNumber - 1n).toString(16).padStart(64, '0')}` as `0x${string}`,
    timestamp: 1_700_000_000n + blockNumber,
    transactions: [],
  } as unknown as Block;
}

function log(blockNumber: bigint, logIndex: number): Log {
  return {
    address: '0x5d7070033f5570a723aa7a59d4ba39ab903e9337',
    blockNumber,
    blockHash: header(blockNumber).hash,
    logIndex,
    topics: [],
    data: '0x',
  } as unknown as Log;
}

function fetcherFor(logs: Log[]): {
  fetcher: BlockFetcher;
  getLogsCalls: Array<{ fromBlock?: bigint; toBlock?: bigint }>;
  headerCalls: bigint[];
} {
  const getLogsCalls: Array<{ fromBlock?: bigint; toBlock?: bigint }> = [];
  const headerCalls: bigint[] = [];
  const rpcClient = {
    getLogs: async (params: { fromBlock?: bigint; toBlock?: bigint }) => {
      getLogsCalls.push(params);
      return logs;
    },
    getBlock: async (params: { blockNumber: bigint; includeTransactions: boolean }) => {
      headerCalls.push(params.blockNumber);
      expect(params.includeTransactions).toBe(false);
      return header(params.blockNumber);
    },
  } as unknown as RPCClient;
  return { fetcher: new BlockFetcher(rpcClient, config, logger), getLogsCalls, headerCalls };
}

describe('log-window fetching', () => {
  it('reads the whole window with a single getLogs call', async () => {
    const { fetcher, getLogsCalls, headerCalls } = fetcherFor([]);

    const blocks = await fetcher.fetchLogWindow(100n, 109n);

    expect(getLogsCalls).toEqual([{ fromBlock: 100n, toBlock: 109n }]);
    expect(headerCalls).toHaveLength(10);
    expect(blocks).toHaveLength(10);
  });

  it('assigns each log to the block it came from', async () => {
    const { fetcher } = fetcherFor([log(100n, 0), log(102n, 0), log(102n, 1)]);

    const blocks = await fetcher.fetchLogWindow(100n, 102n);

    expect(blocks.map((entry) => entry.logs.length)).toEqual([1, 0, 2]);
    expect(blocks.map((entry) => entry.block.number)).toEqual([100n, 101n, 102n]);
  });

  it('reports no transactions or receipts, which this path does not read', async () => {
    const { fetcher } = fetcherFor([log(100n, 0)]);

    const blocks = await fetcher.fetchLogWindow(100n, 100n);

    expect(blocks[0]?.transactions).toEqual([]);
    expect(blocks[0]?.receipts).toEqual([]);
  });

  it('truncates at a missing header so the caller never advances past a gap', async () => {
    const rpcClient = {
      getLogs: async () => [],
      getBlock: async (params: { blockNumber: bigint }) =>
        params.blockNumber === 102n ? null : header(params.blockNumber),
    } as unknown as RPCClient;
    const fetcher = new BlockFetcher(rpcClient, config, logger);

    const blocks = await fetcher.fetchLogWindow(100n, 104n);

    expect(blocks.map((entry) => entry.block.number)).toEqual([100n, 101n]);
  });
});
