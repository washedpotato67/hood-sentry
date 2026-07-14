import { getAddress, isHash } from 'viem';
import { dexRegistry } from '../registries/dex.js';
import type {
  ProtocolContractConfig,
  ProtocolContractRole,
  ProtocolDefinition,
  VersionedProtocolRegistry,
} from './types.js';

const roleMap: Readonly<Record<string, ProtocolContractRole>> = {
  factory: 'factory',
  router: 'router',
  quoter: 'quoter',
  'position-manager': 'positionManager',
  permit2: 'permit2',
};

function verificationTimestamp(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
}

const mainnetDexContracts: readonly ProtocolContractConfig[] = dexRegistry.entries.map((entry) => {
  const contractRole = roleMap[entry.dexType];
  if (contractRole === undefined || entry.runtimeBytecodeHash === null) {
    throw new Error(`DEX registry entry ${entry.key} does not map to a verified protocol role`);
  }
  const runtimeBytecodeHash = entry.runtimeBytecodeHash;
  if (!isHash(runtimeBytecodeHash)) {
    throw new Error(`DEX registry entry ${entry.key} has an invalid runtime bytecode hash`);
  }
  return {
    protocolKey: entry.protocol,
    protocolName: 'Uniswap',
    protocolVersion: entry.protocolVersion,
    chainId: entry.chainId,
    contractRole,
    address: getAddress(entry.address),
    officialSourceUrl: entry.officialSource,
    explorerUrl: `https://robinhoodchain.blockscout.com/address/${entry.address}`,
    verifiedAt: verificationTimestamp(entry.verificationDate),
    runtimeBytecodeHash,
    enabled: entry.enabled,
    notes: entry.notes,
  };
});

const uniswapV2: ProtocolDefinition = {
  protocolKey: 'uniswap',
  protocolName: 'Uniswap',
  protocolVersion: 'v2',
  chainId: 4663,
  kind: 'dex',
  enabled: true,
  contracts: mainnetDexContracts,
};

export const protocolRegistry: VersionedProtocolRegistry = {
  name: 'Robinhood Chain external protocols',
  version: '2.0.0',
  createdAt: '2026-07-14T00:00:00.000Z',
  protocols: [uniswapV2],
};

export const DISABLED_PROTOCOL_REQUIREMENTS = [
  {
    kind: 'launchpad',
    status: 'disabled',
    requiredRoles: ['tokenFactory', 'bondingCurve', 'migration'] as const,
    reason: 'No Robinhood Chain launchpad deployment has complete official and runtime evidence.',
  },
] as const;

export function getProtocolDefinition(
  registry: VersionedProtocolRegistry,
  protocolKey: string,
  protocolVersion: string,
  chainId: number,
): ProtocolDefinition | null {
  return (
    registry.protocols.find(
      (protocol) =>
        protocol.protocolKey === protocolKey &&
        protocol.protocolVersion === protocolVersion &&
        protocol.chainId === chainId,
    ) ?? null
  );
}

export function getProtocolContract(
  definition: ProtocolDefinition,
  role: ProtocolContractRole,
): ProtocolContractConfig | null {
  return definition.contracts.find((contract) => contract.contractRole === role) ?? null;
}
