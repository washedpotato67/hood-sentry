import { describe, expect, it, vi } from 'vitest';
import { BlockscoutPairProvenance, PAIR_CREATED_TOPIC } from './pair-provenance.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const FACTORY = '0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f' as const;
const PAIR = '0x4b26f2f37db21dfe226465307e7fce8d5910064f' as const;
const TX = `0x${'5c'.repeat(32)}` as const;
const BLOCK_HASH = `0x${'ab'.repeat(32)}` as const;

function build(options: {
  creations?: unknown;
  receipt?: unknown;
  capture?: { urls: string[] };
}) {
  return new BlockscoutPairProvenance(
    {
      apiBaseUrl: 'https://explorer.test/api',
      fetchRequest: (async (url: string) => {
        options.capture?.urls.push(String(url));
        return new Response(
          JSON.stringify(
            options.creations ?? {
              message: 'OK',
              result: [
                {
                  contractAddress: PAIR,
                  blockNumber: '9486',
                  txHash: TX,
                  contractFactory: FACTORY,
                  contractCreator: '0x9701fb0ade1e269c8f64ec0c7b3cfadb31a13a52',
                  timestamp: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
          ),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as unknown as typeof fetch,
    },
    {
      getTransactionReceipt: async () =>
        options.receipt ?? {
          blockHash: BLOCK_HASH,
          logs: [
            { address: '0xdead', topics: ['0xother'], logIndex: 3 },
            { address: FACTORY, topics: [PAIR_CREATED_TOPIC], logIndex: 7 },
          ],
        },
    },
    logger,
  );
}

describe('BlockscoutPairProvenance', () => {
  it('returns the creating block, transaction and log index', async () => {
    const provenance = await build({}).lookup([PAIR]);

    expect(provenance.get(PAIR.toLowerCase())).toEqual({
      address: PAIR,
      createdBlock: 9486n,
      createdTxHash: TX,
      createdBlockHash: BLOCK_HASH,
      creationLogIndex: 7,
      factoryAddress: FACTORY.toLowerCase(),
    });
  });

  it('asks for no more addresses than the explorer answers at once', async () => {
    const capture = { urls: [] as string[] };
    const many = Array.from(
      { length: 25 },
      (_unused, index) => `0x${index.toString(16).padStart(40, '0')}` as `0x${string}`,
    );

    await build({ capture }).lookup(many);

    expect(capture.urls).toHaveLength(3);
    for (const url of capture.urls) {
      const addresses = new URL(url).searchParams.get('contractaddresses') ?? '';
      expect(addresses.split(',').length).toBeLessThanOrEqual(10);
    }
  });

  it('omits a pair the explorer does not know rather than guessing', async () => {
    const provenance = await build({ creations: { message: 'OK', result: [] } }).lookup([PAIR]);

    expect(provenance.size).toBe(0);
  });

  it('omits a pair whose creation receipt carries no creation event', async () => {
    const provenance = await build({
      receipt: {
        blockHash: BLOCK_HASH,
        logs: [{ address: '0xdead', topics: ['0x1'], logIndex: 0 }],
      },
    }).lookup([PAIR]);

    expect(provenance.size).toBe(0);
  });
});
