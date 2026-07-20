import type { RPCClient } from '@hood-sentry/chain';
import type { FactoryPairReader } from './pool-backfill.js';

// Uniswap V2 factory and pair selectors. Encoded by hand rather than through an
// ABI so the backfill carries no dependency on an adapter being registered:
// its whole purpose is recovering pools the adapters never saw created.
const ALL_PAIRS_LENGTH = '0x574f2ba3';
const ALL_PAIRS = '0x1e3dd18b';
const TOKEN0 = '0x0dfe1681';
const TOKEN1 = '0xd21220a7';

function encodeIndex(selector: string, index: bigint): `0x${string}` {
  return `${selector}${index.toString(16).padStart(64, '0')}` as `0x${string}`;
}

/** The last 20 bytes of a 32-byte word, which is how addresses are returned. */
function decodeAddress(word: string): `0x${string}` {
  const body = word.startsWith('0x') ? word.slice(2) : word;
  return `0x${body.slice(-40)}` as `0x${string}`;
}

export class RpcFactoryPairReader implements FactoryPairReader {
  constructor(
    private readonly rpcClient: Pick<RPCClient, 'call'>,
    private readonly factoryAddress: `0x${string}`,
  ) {}

  async totalPairs(): Promise<bigint> {
    const result = await this.rpcClient.call({
      to: this.factoryAddress,
      data: ALL_PAIRS_LENGTH as `0x${string}`,
    });
    return BigInt(result);
  }

  async pairAtIndex(index: bigint): Promise<`0x${string}`> {
    const result = await this.rpcClient.call({
      to: this.factoryAddress,
      data: encodeIndex(ALL_PAIRS, index),
    });
    return decodeAddress(result);
  }

  async pairTokens(pairAddress: `0x${string}`): Promise<{
    token0: `0x${string}`;
    token1: `0x${string}`;
  }> {
    // Requested together so the transport's batching can carry both in one
    // request rather than paying a round trip for each.
    const [token0, token1] = await Promise.all([
      this.rpcClient.call({ to: pairAddress, data: TOKEN0 as `0x${string}` }),
      this.rpcClient.call({ to: pairAddress, data: TOKEN1 as `0x${string}` }),
    ]);
    return { token0: decodeAddress(token0), token1: decodeAddress(token1) };
  }
}
