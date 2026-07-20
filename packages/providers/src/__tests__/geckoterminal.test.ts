import { describe, expect, it } from 'vitest';
import { GeckoTerminalTransport, decimalToRaw } from '../geckoterminal.js';

const TOKEN = '0x04245707233836C06dBd13dd8b5F7E82FfA2b762' as const;
const QUOTE = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' as const;

function transportReturning(body: unknown, capture?: { url?: string }) {
  return new GeckoTerminalTransport({
    fetchRequest: (async (url: string) => {
      if (capture) capture.url = String(url);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch,
    now: () => new Date('2026-07-20T12:00:00.000Z'),
  });
}

describe('decimalToRaw', () => {
  it('scales a sub-cent price without losing significant digits', () => {
    // Going through a float here would round the tail away, and this is the
    // magnitude most tokens on this chain actually trade at.
    // 0.0000312124299061638 x 10^18 is 31212429906163.8, so the tail digit is
    // dropped by truncation rather than rounded up.
    expect(decimalToRaw('0.0000312124299061638', 18)).toBe('31212429906163');
  });

  it('scales a whole number', () => {
    expect(decimalToRaw('2', 18)).toBe('2000000000000000000');
  });

  it('truncates rather than rounds past the supported precision', () => {
    expect(decimalToRaw('1.0000000000000000009', 18)).toBe('1000000000000000000');
  });

  it('handles exponent notation, which the provider uses for small values', () => {
    expect(decimalToRaw('5.2e-7', 18)).toBe('520000000000');
  });

  it('rejects a value that is not a number', () => {
    expect(() => decimalToRaw('abc', 18)).toThrow();
  });
});

describe('GeckoTerminalTransport', () => {
  it('returns the provider price scaled to raw integer units', async () => {
    const transport = transportReturning({
      data: {
        attributes: { token_prices: { [TOKEN.toLowerCase()]: '0.0000312124299061638' } },
      },
    });

    const result = await transport.fetchPrice({
      providerName: 'geckoterminal',
      chainId: 4663,
      tokenAddress: TOKEN,
      quoteAssetAddress: QUOTE,
    });

    expect(result).toMatchObject({
      priceRaw: '31212429906163',
      priceDecimals: 18,
      providerTimestamp: '2026-07-20T12:00:00.000Z',
    });
  });

  it('asks the provider for the network matching the chain', async () => {
    const capture: { url?: string } = {};
    const transport = transportReturning(
      { data: { attributes: { token_prices: { [TOKEN.toLowerCase()]: '1' } } } },
      capture,
    );

    await transport.fetchPrice({
      providerName: 'geckoterminal',
      chainId: 4663,
      tokenAddress: TOKEN,
      quoteAssetAddress: QUOTE,
    });

    expect(capture.url).toContain('/networks/robinhood/');
  });

  it('fails rather than inventing a price when the token is absent', async () => {
    const transport = transportReturning({ data: { attributes: { token_prices: {} } } });

    await expect(
      transport.fetchPrice({
        providerName: 'geckoterminal',
        chainId: 4663,
        tokenAddress: TOKEN,
        quoteAssetAddress: QUOTE,
      }),
    ).rejects.toThrow(/no price/i);
  });

  it('refuses a chain the provider does not cover', async () => {
    const transport = transportReturning({ data: { attributes: { token_prices: {} } } });

    await expect(
      transport.fetchPrice({
        providerName: 'geckoterminal',
        chainId: 999,
        tokenAddress: TOKEN,
        quoteAssetAddress: QUOTE,
      }),
    ).rejects.toThrow(/network/i);
  });
});
