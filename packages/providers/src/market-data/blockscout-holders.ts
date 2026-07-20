const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const EXPLORER_BY_CHAIN_ID: Readonly<Record<number, string>> = {
  4663: 'https://robinhoodchain.blockscout.com',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function address(value: unknown): `0x${string}` | null {
  const s = str(value);
  return s !== null && ADDRESS.test(s) ? (s.toLowerCase() as `0x${string}`) : null;
}

function integerString(value: unknown): string | null {
  const s = str(value);
  return s !== null && /^\d+$/.test(s) ? s : null;
}

export interface TokenHolder {
  address: `0x${string}`;
  balanceRaw: string;
}

export interface TokenHolders {
  holders: TokenHolder[];
  totalSupplyRaw: string | null;
  decimals: number | null;
}

export interface BlockscoutHoldersOptions {
  fetchRequest?: typeof fetch;
  baseUrl?: string;
}

/**
 * Reads a token's top holders and supply from the chain's block explorer, which
 * indexes them already, so the product does not have to. A failure yields an
 * empty holder list and null supply rather than throwing: the holders section of
 * a page degrades on its own while the rest still renders.
 */
export class BlockscoutHoldersClient {
  private readonly fetchRequest: typeof fetch;
  private readonly baseUrl: string | null;

  constructor(chainId: number, options: BlockscoutHoldersOptions = {}) {
    this.fetchRequest = options.fetchRequest ?? fetch;
    this.baseUrl = options.baseUrl ?? EXPLORER_BY_CHAIN_ID[chainId] ?? null;
  }

  async tokenHolders(tokenAddress: `0x${string}`): Promise<TokenHolders> {
    if (this.baseUrl === null) return { holders: [], totalSupplyRaw: null, decimals: null };
    const token = tokenAddress.toLowerCase();

    const [holders, meta] = await Promise.all([
      this.getJson(`${this.baseUrl}/api/v2/tokens/${token}/holders`),
      this.getJson(`${this.baseUrl}/api/v2/tokens/${token}`),
    ]);

    const items = Array.isArray(asRecord(holders)?.items)
      ? (asRecord(holders)?.items as unknown[])
      : [];
    const parsed: TokenHolder[] = [];
    for (const item of items) {
      const record = asRecord(item);
      const holderAddress = address(asRecord(record?.address)?.hash);
      const balanceRaw = integerString(record?.value);
      if (holderAddress === null || balanceRaw === null) continue;
      parsed.push({ address: holderAddress, balanceRaw });
    }

    const metaRecord = asRecord(meta);
    return {
      holders: parsed,
      totalSupplyRaw: integerString(metaRecord?.total_supply),
      decimals: typeof metaRecord?.decimals === 'number' ? metaRecord.decimals : null,
    };
  }

  private async getJson(url: string): Promise<unknown | null> {
    try {
      const response = await this.fetchRequest(url, { headers: { accept: 'application/json' } });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }
}
