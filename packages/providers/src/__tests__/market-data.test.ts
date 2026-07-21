import { describe, expect, it } from 'vitest';
import { MarketDataAggregator } from '../market-data/aggregator.js';
import { DexScreenerMarketClient } from '../market-data/dexscreener-market.js';
import { GeckoTerminalMarketClient } from '../market-data/geckoterminal-market.js';
import type { MarketDataSource } from '../market-data/types.js';

const TOKEN = '0x020bfc650a365f8bb26819deaabf3e21291018b4' as const;

const GT_TRENDING = {
  data: [
    {
      id: 'robinhood_0xa70fc67c9f69da90b63a0e4c05d229954574e313',
      attributes: {
        address: '0xa70fc67c9f69da90b63a0e4c05d229954574e313',
        base_token_price_usd: '0.0783705',
        reserve_in_usd: '3760730.03',
        volume_usd: { h24: '5629048.80' },
        pool_created_at: '2026-06-01T00:00:00Z',
      },
      relationships: { base_token: { data: { id: `robinhood_${TOKEN}` } } },
    },
    {
      // A shallower second pool for the same token: the deeper one wins.
      id: 'robinhood_0xbbbb',
      attributes: {
        address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        base_token_price_usd: '0.07',
        reserve_in_usd: '100.0',
        volume_usd: { h24: '5.0' },
      },
      relationships: { base_token: { data: { id: `robinhood_${TOKEN}` } } },
    },
  ],
  included: [
    {
      id: `robinhood_${TOKEN}`,
      type: 'token',
      attributes: { name: 'Cash Cat', symbol: 'CASHCAT', decimals: 18 },
    },
  ],
};

function gtStub(body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

describe('GeckoTerminalMarketClient', () => {
  it('collapses trending pools to one entry per token, keeping the deepest pool', async () => {
    const client = new GeckoTerminalMarketClient({ fetchRequest: gtStub(GT_TRENDING) });

    const tokens = await client.trending(4663);

    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      address: TOKEN,
      symbol: 'CASHCAT',
      decimals: 18,
      priceUsd: '0.0783705',
      liquidityUsd: '3760730.03',
      volume24hUsd: '5629048.80',
    });
  });

  it('finds tokens by search, collapsed to one per token', async () => {
    const client = new GeckoTerminalMarketClient({ fetchRequest: gtStub(GT_TRENDING) });

    const results = await client.search(4663, 'cash');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ address: TOKEN, symbol: 'CASHCAT' });
  });

  it('returns nothing for an empty query', async () => {
    const client = new GeckoTerminalMarketClient({ fetchRequest: gtStub(GT_TRENDING) });
    expect(await client.search(4663, '   ')).toEqual([]);
  });

  it('returns nothing for a chain it does not cover rather than another chain', async () => {
    const client = new GeckoTerminalMarketClient({ fetchRequest: gtStub(GT_TRENDING) });
    expect(await client.trending(999)).toEqual([]);
  });

  it('returns an empty feed rather than throwing when the source errors', async () => {
    const failing = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const client = new GeckoTerminalMarketClient({ fetchRequest: failing });
    expect(await client.trending(4663)).toEqual([]);
  });
});

describe('DexScreenerMarketClient', () => {
  const DS_BODY = {
    pairs: [
      {
        chainId: 'robinhood',
        dexId: 'uniswap',
        pairAddress: '0xA70fc67C9F69da90B63a0e4C05D229954574E313',
        baseToken: { address: TOKEN, name: 'Cash Cat', symbol: 'CASHCAT' },
        quoteToken: { address: '0x0bd7d308f8e1639fab988df18a8011f41eacad73' },
        priceUsd: '0.0783',
        liquidity: { usd: 3760730 },
        volume: { h24: 5629048 },
        pairCreatedAt: 1781812885000,
      },
      { chainId: 'ethereum', pairAddress: '0xdead', liquidity: { usd: 9e9 } },
    ],
  };

  it('reads a token market from the deepest same-chain pair', async () => {
    const client = new DexScreenerMarketClient({ fetchRequest: gtStub(DS_BODY) });

    const market = await client.tokenMarket(4663, TOKEN);

    expect(market).toMatchObject({
      address: TOKEN,
      symbol: 'CASHCAT',
      priceUsd: '0.0783',
      liquidityUsd: '3760730',
    });
  });

  it('ignores pairs from other chains', async () => {
    const onlyOtherChain = { pairs: [{ chainId: 'ethereum', pairAddress: '0xdead' }] };
    const client = new DexScreenerMarketClient({ fetchRequest: gtStub(onlyOtherChain) });
    expect(await client.tokenMarket(4663, TOKEN)).toBeNull();
  });

  it('builds a trending feed from the chain boosts + a batch token lookup', async () => {
    // First call: boosts list; second: batch token market data.
    const responses = [
      [
        { chainId: 'robinhood', tokenAddress: TOKEN },
        { chainId: 'ethereum', tokenAddress: '0xdead' },
      ],
      DS_BODY,
    ];
    let call = 0;
    const fetchRequest = (async () =>
      new Response(JSON.stringify(responses[call++]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    const client = new DexScreenerMarketClient({ fetchRequest });

    const tokens = await client.trending(4663);

    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ address: TOKEN, symbol: 'CASHCAT' });
  });
});

describe('MarketDataAggregator', () => {
  const emptySource: MarketDataSource = {
    trending: async () => [],
    newPools: async () => [],
    tokenMarket: async () => null,
    pools: async () => [],
    search: async () => [],
  };

  it('falls back to the secondary source when the primary has no price', async () => {
    const primary: MarketDataSource = { ...emptySource, tokenMarket: async () => null };
    const fallback: MarketDataSource = {
      ...emptySource,
      tokenMarket: async () => ({
        address: TOKEN,
        name: null,
        symbol: 'X',
        decimals: null,
        priceUsd: '1.5',
        liquidityUsd: null,
        volume24hUsd: null,
        primaryPoolAddress: null,
        poolCreatedAt: null,
      }),
    };
    const aggregator = new MarketDataAggregator(primary, fallback);

    const market = await aggregator.tokenMarket(4663, TOKEN);

    expect(market?.priceUsd).toBe('1.5');
  });

  it('keeps the primary result when it already has a price', async () => {
    const primary: MarketDataSource = {
      ...emptySource,
      tokenMarket: async () => ({
        address: TOKEN,
        name: null,
        symbol: 'P',
        decimals: null,
        priceUsd: '9',
        liquidityUsd: null,
        volume24hUsd: null,
        primaryPoolAddress: null,
        poolCreatedAt: null,
      }),
    };
    const fallback: MarketDataSource = {
      ...emptySource,
      tokenMarket: async () => {
        throw new Error('fallback should not be consulted');
      },
    };
    const aggregator = new MarketDataAggregator(primary, fallback);

    expect((await aggregator.tokenMarket(4663, TOKEN))?.symbol).toBe('P');
  });

  const oneToken = (symbol: string) => ({
    address: TOKEN,
    name: null,
    symbol,
    decimals: null,
    priceUsd: '1',
    liquidityUsd: null,
    volume24hUsd: null,
    primaryPoolAddress: null,
    poolCreatedAt: null,
  });

  it('falls back to the secondary trending feed when the primary is empty', async () => {
    const primary: MarketDataSource = { ...emptySource, trending: async () => [] };
    const fallback: MarketDataSource = { ...emptySource, trending: async () => [oneToken('F')] };
    const aggregator = new MarketDataAggregator(primary, fallback);

    const tokens = await aggregator.trending(4663);

    expect(tokens.map((t) => t.symbol)).toEqual(['F']);
  });

  it('keeps the primary trending feed when it has results', async () => {
    const primary: MarketDataSource = { ...emptySource, trending: async () => [oneToken('P')] };
    const fallback: MarketDataSource = {
      ...emptySource,
      trending: async () => {
        throw new Error('fallback should not be consulted');
      },
    };
    const aggregator = new MarketDataAggregator(primary, fallback);

    expect((await aggregator.trending(4663)).map((t) => t.symbol)).toEqual(['P']);
  });
});
