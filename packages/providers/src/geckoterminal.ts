import { z } from 'zod';

/**
 * GeckoTerminal names networks rather than numbering them, and covers only the
 * ones it has indexed. An unmapped chain must fail rather than fall back to a
 * default network, which would return another chain's prices under this chain's
 * addresses.
 */
const NETWORK_BY_CHAIN_ID: Readonly<Record<number, string>> = {
  4663: 'robinhood',
};

const responseSchema = z.object({
  data: z.object({
    attributes: z.object({
      token_prices: z.record(z.string(), z.string().nullable()),
    }),
  }),
});

/**
 * Scale a decimal string to integer units without going through a float.
 *
 * Tokens on this chain routinely trade below a millionth of a dollar, where
 * `Number` silently drops the significant digits that carry all the meaning.
 * Truncates rather than rounds: an extra unit invented at the boundary is a
 * price nobody quoted.
 */
export function decimalToRaw(value: string, decimals: number): string {
  const normalized = normalizeExponent(value.trim());
  if (!/^-?\d*(\.\d*)?$/.test(normalized) || /^-?\.?$/.test(normalized)) {
    throw new Error(`Not a decimal number: ${value}`);
  }
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const scaled = `${whole}${fraction.padEnd(decimals, '0').slice(0, decimals)}`;
  const trimmed = scaled.replace(/^0+(?=\d)/, '');
  return `${negative && trimmed !== '0' ? '-' : ''}${trimmed}`;
}

/** Rewrites `5.2e-7` into plain decimal notation so the scaler can read it. */
function normalizeExponent(value: string): string {
  const match = /^(-?)(\d*)(?:\.(\d*))?[eE]([+-]?\d+)$/.exec(value);
  if (match === null) return value;
  const [, sign = '', whole = '0', fraction = '', exponentText = '0'] = match;
  const exponent = Number(exponentText);
  const digits = `${whole}${fraction}`;
  const pointIndex = whole.length + exponent;
  if (pointIndex <= 0) return `${sign}0.${'0'.repeat(-pointIndex)}${digits}`;
  if (pointIndex >= digits.length)
    return `${sign}${digits}${'0'.repeat(pointIndex - digits.length)}`;
  return `${sign}${digits.slice(0, pointIndex)}.${digits.slice(pointIndex)}`;
}

export interface GeckoTerminalOptions {
  fetchRequest?: typeof fetch;
  now?: () => Date;
  baseUrl?: string;
  priceDecimals?: number;
}

/**
 * Reads token prices from GeckoTerminal's public API, which covers this chain
 * and needs no key.
 *
 * The price is quoted in US dollars, not in the pool's quote asset, and the
 * provider reports no observation time, so the timestamp recorded is when we
 * read it. Both are why a price from here is stored as an `externalProvider`
 * source and shown as attributed to the provider, rather than presented
 * alongside prices derived from reserves this system observed itself.
 */
export class GeckoTerminalTransport {
  private readonly fetchRequest: typeof fetch;
  private readonly now: () => Date;
  private readonly baseUrl: string;
  private readonly priceDecimals: number;

  constructor(options: GeckoTerminalOptions = {}) {
    this.fetchRequest = options.fetchRequest ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.baseUrl = options.baseUrl ?? 'https://api.geckoterminal.com/api/v2';
    this.priceDecimals = options.priceDecimals ?? 18;
  }

  async fetchPrice(input: {
    providerName: string;
    chainId: number;
    tokenAddress: `0x${string}`;
    quoteAssetAddress: `0x${string}`;
  }): Promise<unknown> {
    const network = NETWORK_BY_CHAIN_ID[input.chainId];
    if (network === undefined) {
      throw new Error(`GeckoTerminal has no network for chain ${input.chainId}`);
    }

    const address = input.tokenAddress.toLowerCase();
    const response = await this.fetchRequest(
      `${this.baseUrl}/simple/networks/${network}/token_price/${address}`,
      { headers: { accept: 'application/json' } },
    );
    if (!response.ok) {
      throw new Error(`GeckoTerminal responded ${response.status}`);
    }

    const parsed = responseSchema.parse(await response.json());
    const price = parsed.data.attributes.token_prices[address];
    if (price === undefined || price === null || price === '') {
      throw new Error(`GeckoTerminal returned no price for ${input.tokenAddress}`);
    }

    return {
      priceRaw: decimalToRaw(price, this.priceDecimals),
      priceDecimals: this.priceDecimals,
      providerTimestamp: this.now().toISOString(),
    };
  }
}
