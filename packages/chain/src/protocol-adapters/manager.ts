import type { Address } from 'viem';
import {
  DuplicatePoolEventError,
  MalformedProtocolLogError,
  UnknownFactoryError,
  UnknownPoolError,
} from './errors.js';
import { parseProtocolLog } from './log.js';
import type { NormalizedPool, NormalizedProtocolEvent, ProtocolAdapter } from './types.js';

interface RegisteredPool {
  pool: NormalizedPool;
  adapter: ProtocolAdapter;
}

export class ProtocolAdapterManager {
  private readonly adaptersByFactory = new Map<string, ProtocolAdapter>();
  private readonly adaptersByKey = new Map<string, ProtocolAdapter>();
  private readonly pools = new Map<string, RegisteredPool>();
  private readonly poolEventKeys = new Set<string>();

  constructor(adapters: readonly ProtocolAdapter[]) {
    for (const adapter of adapters) {
      const factoryKey = this.addressKey(
        adapter.manifest.chainId,
        adapter.manifest.factory.address,
      );
      const adapterKey = this.adapterKey(
        adapter.manifest.chainId,
        adapter.manifest.protocol,
        adapter.manifest.version,
      );
      if (this.adaptersByFactory.has(factoryKey) || this.adaptersByKey.has(adapterKey)) {
        throw new Error(`Duplicate protocol adapter registration for ${adapterKey}`);
      }
      this.adaptersByFactory.set(factoryKey, adapter);
      this.adaptersByKey.set(adapterKey, adapter);
    }
  }

  discoverPool(value: unknown): NormalizedPool {
    const log = parseProtocolLog(value);
    const adapter = this.adaptersByFactory.get(this.addressKey(log.chainId, log.address));
    if (adapter === undefined) throw new UnknownFactoryError(log.address);
    const pool = adapter.discoverPool(log);
    if (pool === null) {
      throw new MalformedProtocolLogError('Factory log does not match the pool creation event');
    }
    const eventKey = `${pool.provenance.chainId}:${pool.provenance.transactionHash}:${pool.provenance.logIndex}`;
    const poolKey = this.addressKey(pool.provenance.chainId, pool.address);
    if (this.poolEventKeys.has(eventKey) || this.pools.has(poolKey)) {
      throw new DuplicatePoolEventError(pool.address);
    }
    this.poolEventKeys.add(eventKey);
    this.pools.set(poolKey, { pool, adapter });
    return pool;
  }

  registerPool(pool: NormalizedPool): void {
    const adapter = this.adaptersByKey.get(
      this.adapterKey(pool.provenance.chainId, pool.protocol, pool.version),
    );
    if (adapter === undefined) throw new UnknownFactoryError(pool.factory);
    adapter.assertSupportedFeeTier(pool.fee);
    if (adapter.manifest.factory.address.toLowerCase() !== pool.factory.toLowerCase()) {
      throw new UnknownFactoryError(pool.factory);
    }
    this.pools.set(this.addressKey(pool.provenance.chainId, pool.address), { pool, adapter });
  }

  decodePoolEvent(value: unknown): NormalizedProtocolEvent | null {
    const log = parseProtocolLog(value);
    const registered = this.pools.get(this.addressKey(log.chainId, log.address));
    if (registered === undefined) throw new UnknownPoolError(log.address);
    const swap = registered.adapter.decodeSwap(log, registered.pool);
    if (swap !== null) return swap;
    const addition = registered.adapter.decodeLiquidityAddition(log, registered.pool);
    if (addition !== null) return addition;
    return registered.adapter.decodeLiquidityRemoval(log, registered.pool);
  }

  getRegisteredPool(chainId: number, address: Address): NormalizedPool | null {
    return this.pools.get(this.addressKey(chainId, address))?.pool ?? null;
  }

  private addressKey(chainId: number, address: Address): string {
    return `${chainId}:${address.toLowerCase()}`;
  }

  private adapterKey(chainId: number, protocol: string, version: string): string {
    return `${chainId}:${protocol}:${version}`;
  }
}
