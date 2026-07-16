import { type Address, type Hex, encodeFunctionData, encodeFunctionResult } from 'viem';
import { describe, expect, it } from 'vitest';
import { aggregatorV3InterfaceAbi, sequencerUptimeFeedAbi } from '../abis/chainlink.js';
import { OracleClient } from '../oracle/oracle-client.js';
import type { RPCClient } from '../rpc/index.js';

const FEED_ADDRESS = '0x1000000000000000000000000000000000000001' as Address;
const SEQUENCER_ADDRESS = '0x2000000000000000000000000000000000000002' as Address;

function createMockRpcClient(calls: Map<string, Hex>): RPCClient {
  return {
    call: async ({ to, data }: { to: Address; data: Hex; blockNumber?: bigint }) => {
      const key = `${to.toLowerCase()}:${data}`;
      const result = calls.get(key);
      if (result === undefined) throw new Error(`Unexpected call: ${key}`);
      return result;
    },
    getCode: async () => '0x6000',
    getPrimaryProviderUrl: () => 'http://localhost:8545',
  } as unknown as RPCClient;
}

function decimalsData(): Hex {
  return '0x313ce567';
}

function latestRoundDataData(): Hex {
  return '0xfeaf968c';
}

function pausedData(): Hex {
  return encodeFunctionData({
    abi: aggregatorV3InterfaceAbi,
    functionName: 'paused',
  });
}

function decimalsReturn(value: number): Hex {
  return encodeFunctionResult({
    abi: aggregatorV3InterfaceAbi,
    functionName: 'decimals',
    result: value,
  });
}

function priceReturn(input: {
  roundId: bigint;
  answer: bigint;
  startedAt: bigint;
  updatedAt: bigint;
  answeredInRound: bigint;
}): Hex {
  return encodeFunctionResult({
    abi: aggregatorV3InterfaceAbi,
    functionName: 'latestRoundData',
    result: [input.roundId, input.answer, input.startedAt, input.updatedAt, input.answeredInRound],
  });
}

function pausedReturn(value: boolean): Hex {
  return encodeFunctionResult({
    abi: aggregatorV3InterfaceAbi,
    functionName: 'paused',
    result: value,
  });
}

function sequencerReturn(input: {
  roundId: bigint;
  answer: bigint;
  startedAt: bigint;
  updatedAt: bigint;
  answeredInRound: bigint;
}): Hex {
  return encodeFunctionResult({
    abi: sequencerUptimeFeedAbi,
    functionName: 'latestRoundData',
    result: [input.roundId, input.answer, input.startedAt, input.updatedAt, input.answeredInRound],
  });
}

describe('OracleClient', () => {
  it('reads price feed round data', async () => {
    const updatedAt = 1_750_000_000n;
    const calls = new Map<string, Hex>([
      [`${FEED_ADDRESS.toLowerCase()}:${decimalsData()}`, decimalsReturn(8)],
      [
        `${FEED_ADDRESS.toLowerCase()}:${latestRoundDataData()}`,
        priceReturn({
          roundId: 100n,
          answer: 123_456_789n,
          startedAt: updatedAt - 60n,
          updatedAt,
          answeredInRound: 100n,
        }),
      ],
    ]);
    const client = new OracleClient({ rpcClient: createMockRpcClient(calls), chainId: 4663 });
    const result = await client.readPriceFeed(FEED_ADDRESS);
    expect(result.answer).toBe(123_456_789n);
    expect(result.decimals).toBe(8);
    expect(result.roundId).toBe(100n);
    expect(result.updatedAt).toBe(new Date(Number(updatedAt) * 1000).toISOString());
  });

  it('reads sequencer uptime feed as up', async () => {
    const updatedAt = 1_750_000_000n;
    const calls = new Map<string, Hex>([
      [
        `${SEQUENCER_ADDRESS.toLowerCase()}:${latestRoundDataData()}`,
        sequencerReturn({
          roundId: 1n,
          answer: 0n,
          startedAt: updatedAt - 300n,
          updatedAt,
          answeredInRound: 1n,
        }),
      ],
    ]);
    const client = new OracleClient({ rpcClient: createMockRpcClient(calls), chainId: 4663 });
    const result = await client.readSequencerFeed(SEQUENCER_ADDRESS);
    expect(result.up).toBe(true);
    expect(result.recoveredAt).toBe(updatedAt - 300n);
  });

  it('reads sequencer uptime feed as down', async () => {
    const updatedAt = 1_750_000_000n;
    const calls = new Map<string, Hex>([
      [
        `${SEQUENCER_ADDRESS.toLowerCase()}:${latestRoundDataData()}`,
        sequencerReturn({
          roundId: 1n,
          answer: 1n,
          startedAt: updatedAt - 60n,
          updatedAt,
          answeredInRound: 1n,
        }),
      ],
    ]);
    const client = new OracleClient({ rpcClient: createMockRpcClient(calls), chainId: 4663 });
    const result = await client.readSequencerFeed(SEQUENCER_ADDRESS);
    expect(result.up).toBe(false);
    expect(result.recoveredAt).toBeUndefined();
  });

  it('returns zero-code when the contract has no code', async () => {
    const rpcClient = {
      call: async () => '0x',
      getCode: async () => '0x',
      getPrimaryProviderUrl: () => 'http://localhost:8545',
    } as unknown as RPCClient;
    const client = new OracleClient({ rpcClient, chainId: 4663 });
    const code = await client.getCode(FEED_ADDRESS);
    expect(code).toBe('0x');
  });

  it('reads paused state when the feed exposes it', async () => {
    const calls = new Map<string, Hex>([
      [`${FEED_ADDRESS.toLowerCase()}:${pausedData()}`, pausedReturn(true)],
    ]);
    const client = new OracleClient({ rpcClient: createMockRpcClient(calls), chainId: 4663 });
    await expect(client.readPaused(FEED_ADDRESS)).resolves.toBe(true);
  });

  it('treats a missing paused selector as not paused', async () => {
    const client = new OracleClient({
      rpcClient: createMockRpcClient(new Map()),
      chainId: 4663,
    });
    await expect(client.readPaused(FEED_ADDRESS)).resolves.toBe(false);
  });
});
