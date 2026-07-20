import { describe, expect, it } from 'vitest';
import { BlockscoutHoldersClient } from '../market-data/blockscout-holders.js';

const TOKEN = '0x020bfc650a365f8bb26819deaabf3e21291018b4' as const;

function router(routes: Record<string, unknown>): typeof fetch {
  return (async (url: string) => {
    const match = Object.entries(routes).find(([suffix]) => String(url).endsWith(suffix));
    if (match === undefined) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(match[1]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('BlockscoutHoldersClient', () => {
  it('reads holders with balances and supply', async () => {
    const client = new BlockscoutHoldersClient(4663, {
      fetchRequest: router({
        [`/tokens/${TOKEN}/holders`]: {
          items: [
            { address: { hash: '0x2dBAf98620000000000000000000000000000001' }, value: '32101838' },
            { address: { hash: '0x8366a39CC6000000000000000000000000000002' }, value: '26007442' },
          ],
        },
        [`/tokens/${TOKEN}`]: { total_supply: '1000000000000000000000000000', decimals: 18 },
      }),
    });

    const result = await client.tokenHolders(TOKEN);

    expect(result.holders).toHaveLength(2);
    expect(result.holders[0]).toEqual({
      address: '0x2dbaf98620000000000000000000000000000001',
      balanceRaw: '32101838',
    });
    expect(result.totalSupplyRaw).toBe('1000000000000000000000000000');
    expect(result.decimals).toBe(18);
  });

  it('degrades to empty rather than throwing when the explorer errors', async () => {
    const failing = (async () => new Response('down', { status: 500 })) as unknown as typeof fetch;
    const client = new BlockscoutHoldersClient(4663, { fetchRequest: failing });

    expect(await client.tokenHolders(TOKEN)).toEqual({
      holders: [],
      totalSupplyRaw: null,
      decimals: null,
    });
  });

  it('returns empty for a chain with no configured explorer', async () => {
    const client = new BlockscoutHoldersClient(999);
    expect((await client.tokenHolders(TOKEN)).holders).toEqual([]);
  });
});
