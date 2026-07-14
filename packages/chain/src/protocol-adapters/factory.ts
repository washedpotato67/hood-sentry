import type { DexContractEntry, Registry, SupportedChainId } from '../types.js';
import { ProtocolAdapterManager } from './manager.js';
import type { ProtocolAdapter } from './types.js';
import { UniswapV2Adapter } from './uniswap-v2.js';

export interface ProtocolAdapterFactory {
  protocol: string;
  version: string;
  create(registry: Registry<DexContractEntry>, chainId: SupportedChainId): ProtocolAdapter;
}

const defaultAdapterFactories: readonly ProtocolAdapterFactory[] = [
  {
    protocol: 'uniswap',
    version: 'v2',
    create: (registry, chainId) => new UniswapV2Adapter(registry, chainId),
  },
];

export function createProtocolAdapterManager(
  registry: Registry<DexContractEntry>,
  chainId: SupportedChainId,
  factories: readonly ProtocolAdapterFactory[] = defaultAdapterFactories,
): ProtocolAdapterManager {
  const configuredProtocols = new Set(
    registry.entries
      .filter((entry) => entry.chainId === chainId && entry.enabled && entry.dexType === 'factory')
      .map((entry) => `${entry.protocol}:${entry.protocolVersion}`),
  );
  const adapters = factories
    .filter((factory) => configuredProtocols.has(`${factory.protocol}:${factory.version}`))
    .map((factory) => factory.create(registry, chainId));

  if (adapters.length !== configuredProtocols.size) {
    throw new Error('Protocol registry contains a venue without an adapter implementation');
  }
  return new ProtocolAdapterManager(adapters);
}
