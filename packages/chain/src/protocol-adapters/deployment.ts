import { getAddress, isHash } from 'viem';
import { z } from 'zod';
import type { DexContractEntry, Registry, SupportedChainId } from '../types.js';
import { UnverifiedProtocolContractError } from './errors.js';
import type {
  ProtocolAdapterManifest,
  ProtocolContractRole,
  ProtocolEventSignatures,
  VerifiedProtocolContract,
} from './types.js';

const sourceSchema = z
  .string()
  .url()
  .refine((source) => source.startsWith('https://'));

function findVerifiedContract(
  registry: Registry<DexContractEntry>,
  chainId: SupportedChainId,
  protocol: string,
  version: string,
  role: ProtocolContractRole,
  required: boolean,
): VerifiedProtocolContract | null {
  const matches = registry.entries.filter(
    (entry) =>
      entry.chainId === chainId &&
      entry.protocol === protocol &&
      entry.protocolVersion === version &&
      entry.dexType === role &&
      entry.enabled,
  );
  if (matches.length > 1) {
    throw new UnverifiedProtocolContractError(
      `Protocol registry has multiple enabled ${role} entries for ${protocol} ${version}`,
    );
  }
  const entry = matches[0];
  if (entry === undefined) {
    if (!required) return null;
    throw new UnverifiedProtocolContractError(
      `Protocol registry lacks a verified ${role} for ${protocol} ${version}`,
    );
  }
  const runtimeBytecodeHash = entry.runtimeBytecodeHash;
  const parsedSource = sourceSchema.safeParse(entry.officialSource);
  if (
    runtimeBytecodeHash === null ||
    !isHash(runtimeBytecodeHash) ||
    !parsedSource.success ||
    entry.verificationDate.length === 0
  ) {
    throw new UnverifiedProtocolContractError(
      `Protocol registry ${role} entry lacks source or runtime bytecode verification`,
    );
  }
  return {
    role,
    address: getAddress(entry.address),
    runtimeBytecodeHash,
    source: parsedSource.data,
    verifiedAt: entry.verificationDate,
  };
}

interface ManifestRequest {
  registry: Registry<DexContractEntry>;
  chainId: SupportedChainId;
  protocol: string;
  version: string;
  supportedFeeTiers: readonly number[];
  eventSignatures: ProtocolEventSignatures;
  requiredRoles: readonly ProtocolContractRole[];
}

export function loadVerifiedProtocolManifest(request: ManifestRequest): ProtocolAdapterManifest {
  const load = (role: ProtocolContractRole) =>
    findVerifiedContract(
      request.registry,
      request.chainId,
      request.protocol,
      request.version,
      role,
      request.requiredRoles.includes(role),
    );
  const factory = load('factory');
  if (factory === null) {
    throw new UnverifiedProtocolContractError('Every protocol adapter requires a verified factory');
  }
  const router = load('router');
  const quoter = load('quoter');
  const positionManager = load('position-manager');
  const permit2 = load('permit2');

  return {
    chainId: request.chainId,
    protocol: request.protocol,
    version: request.version,
    factory,
    router,
    quoter,
    positionManager,
    permit2,
    supportedFeeTiers: [...request.supportedFeeTiers],
    eventSignatures: request.eventSignatures,
    source: factory.source,
    bytecodeHashes: {
      factory: factory.runtimeBytecodeHash,
      router: router?.runtimeBytecodeHash ?? null,
      quoter: quoter?.runtimeBytecodeHash ?? null,
      'position-manager': positionManager?.runtimeBytecodeHash ?? null,
      permit2: permit2?.runtimeBytecodeHash ?? null,
    },
  };
}
