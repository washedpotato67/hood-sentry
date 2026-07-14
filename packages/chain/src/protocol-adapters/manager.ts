import type { Address } from 'viem';
import { DuplicateProtocolEventError, UnknownPoolError, UnknownProtocolError } from './errors.js';
import { parseRawChainLog } from './log.js';
import type {
  DecodedProtocolEvent,
  DexAdapter,
  LaunchpadAdapter,
  NormalizedProtocolEvent,
  ProtocolAdapter,
  RawChainLog,
} from './types.js';

export interface RoutedProtocolEvent {
  adapter: ProtocolAdapter;
  decoded: DecodedProtocolEvent;
  normalized: NormalizedProtocolEvent | null;
}

export class ProtocolAdapterManager {
  private readonly adaptersByKey = new Map<string, ProtocolAdapter>();
  private readonly adapters: ProtocolAdapter[] = [];
  private readonly processedEventKeys = new Set<string>();

  constructor(adapters: readonly ProtocolAdapter[]) {
    for (const adapter of adapters) {
      const key = this.key(adapter.chainId, adapter.protocolKey, adapter.version);
      if (this.adaptersByKey.has(key)) {
        throw new Error(`Duplicate active protocol adapter ${key}`);
      }
      this.adaptersByKey.set(key, adapter);
      this.adapters.push(adapter);
    }
  }

  getActiveAdapters(): readonly ProtocolAdapter[] {
    return [...this.adapters];
  }

  getAdapter(protocolKey: string, protocolVersion: string, chainId: number): ProtocolAdapter {
    const adapter = this.adaptersByKey.get(this.key(chainId, protocolKey, protocolVersion));
    if (adapter === undefined) throw new UnknownProtocolError(protocolKey);
    return adapter;
  }

  registerPool(pool: Parameters<DexAdapter['registerPool']>[0]): void {
    const adapter = this.getAdapter(pool.protocolKey, pool.protocolVersion, pool.chainId);
    if (!this.isDexAdapter(adapter)) throw new UnknownPoolError(pool.poolAddress);
    adapter.registerPool(pool);
  }

  async routeLog(value: unknown): Promise<RoutedProtocolEvent | null> {
    const log = parseRawChainLog(value);
    const adapter = this.adapters.find(
      (candidate) => candidate.chainId === log.chainId && candidate.supportsAddress(log.address),
    );
    if (adapter === undefined) return null;
    const decoded = await adapter.decodeLog(log);
    if (decoded === null) return null;
    const normalized = await this.normalize(adapter, decoded, log);
    if (normalized !== null) this.assertUnique(decoded);
    return { adapter, decoded, normalized };
  }

  private async normalize(
    adapter: ProtocolAdapter,
    decoded: DecodedProtocolEvent,
    log: RawChainLog,
  ): Promise<NormalizedProtocolEvent | null> {
    if (this.isDexAdapter(adapter)) {
      if (decoded.kind === 'poolCreated') return adapter.discoverPool(decoded);
      if (decoded.kind === 'swap') return adapter.decodeSwap(log);
      return adapter.decodeLiquidityEvent(log);
    }
    if (this.isLaunchpadAdapter(adapter)) {
      if (decoded.kind === 'launchpadTokenCreated') return adapter.decodeTokenCreation(log);
      if (decoded.kind === 'bondingCurveBuy' || decoded.kind === 'bondingCurveSell') {
        return adapter.decodeBondingCurveTrade(log);
      }
      if (decoded.kind === 'launchpadGraduated') return adapter.decodeGraduation(log);
      if (decoded.kind === 'launchpadMigrated') return adapter.decodeMigration(log);
    }
    return null;
  }

  private assertUnique(event: DecodedProtocolEvent): void {
    const provenance = event.provenance;
    const key = `${provenance.chainId}:${provenance.blockHash}:${provenance.transactionHash}:${provenance.logIndex}`;
    if (this.processedEventKeys.has(key)) {
      throw new DuplicateProtocolEventError(
        event.kind,
        provenance.transactionHash,
        provenance.logIndex,
      );
    }
    this.processedEventKeys.add(key);
  }

  private isDexAdapter(adapter: ProtocolAdapter): adapter is DexAdapter {
    return adapter.kind === 'dex';
  }

  private isLaunchpadAdapter(adapter: ProtocolAdapter): adapter is LaunchpadAdapter {
    return adapter.kind === 'launchpad';
  }

  private key(chainId: number, protocolKey: string, protocolVersion: string): string {
    return `${chainId}:${protocolKey}:${protocolVersion}`;
  }
}

export function addressIdentity(chainId: number, address: Address): string {
  return `${chainId}:${address.toLowerCase()}`;
}
