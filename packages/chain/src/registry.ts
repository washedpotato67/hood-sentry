import { type Address, getAddress } from 'viem';
import {
  type DexContractEntry,
  type Registry,
  type RegistryEntry,
  type SupportedChainId,
  isSupportedChainId,
} from './types.js';

function isDexContractEntry(entry: RegistryEntry): entry is DexContractEntry {
  return 'dexType' in entry && 'protocol' in entry && 'protocolVersion' in entry;
}

function validateDexEntryFields(entry: DexContractEntry, issues: string[]): void {
  if (entry.protocol.trim().length === 0 || entry.protocolVersion.trim().length === 0) {
    issues.push(`DEX entry "${entry.name}" lacks protocol or version`);
  }
  if (entry.runtimeBytecodeHash === null || !/^0x[0-9a-f]{64}$/.test(entry.runtimeBytecodeHash)) {
    issues.push(`DEX entry "${entry.name}" lacks a verified runtime bytecode hash`);
  }
}

export class RegistryValidationError extends Error {
  constructor(
    public readonly registryName: string,
    public readonly issues: string[],
  ) {
    super(
      `Registry "${registryName}" validation failed:\n${issues.map((i) => `  - ${i}`).join('\n')}`,
    );
    this.name = 'RegistryValidationError';
  }
}

export function checksumAddress(address: string): Address {
  try {
    return getAddress(address);
  } catch {
    throw new Error(`Invalid Ethereum address: ${address}`);
  }
}

function validateEntryFields(entry: RegistryEntry, issues: string[]): void {
  if (!entry.name || entry.name.trim().length === 0) {
    issues.push(`Entry with key "${entry.key}" has an empty name`);
  }
  if (!entry.key || entry.key.trim().length === 0) {
    issues.push(`Entry "${entry.name}" has an empty key`);
  }
  if (!entry.role || entry.role.trim().length === 0) {
    issues.push(`Entry "${entry.name}" has an empty role`);
  }
  if (!entry.officialSource || entry.officialSource.trim().length === 0) {
    issues.push(`Entry "${entry.name}" has an empty official source`);
  }
  if (!entry.verificationDate || entry.verificationDate.trim().length === 0) {
    issues.push(`Entry "${entry.name}" has an empty verification date`);
  }
  if (isDexContractEntry(entry)) {
    validateDexEntryFields(entry, issues);
  }
}

function validateEntryChainId(entry: RegistryEntry, issues: string[]): void {
  if (!isSupportedChainId(entry.chainId)) {
    issues.push(
      `Entry "${entry.name}" has unsupported chain ID: ${entry.chainId}. Supported: 4663, 46630`,
    );
  }
}

function validateEntryAddress(entry: RegistryEntry, issues: string[]): void {
  try {
    const checksummed = getAddress(entry.address);
    if (checksummed !== entry.address) {
      issues.push(
        `Entry "${entry.name}" address is not checksummed. Expected: ${checksummed}, got: ${entry.address}`,
      );
    }
  } catch {
    issues.push(`Entry "${entry.name}" has invalid address format: ${entry.address}`);
  }

  if (entry.address === '0x0000000000000000000000000000000000000000') {
    issues.push(`Entry "${entry.name}" uses the zero address`);
  }
}

function validateNoDuplicateAddressRole(
  entries: ReadonlyArray<RegistryEntry>,
  issues: string[],
): void {
  const addressRoleMap = new Map<string, string>();

  for (const entry of entries) {
    const compositeKey = `${entry.chainId}:${entry.address.toLowerCase()}:${entry.role}`;
    const existing = addressRoleMap.get(compositeKey);
    if (existing) {
      issues.push(
        `Duplicate address+role: "${entry.name}" and "${existing}" share ${entry.address} with role "${entry.role}" on chain ${entry.chainId}`,
      );
    } else {
      addressRoleMap.set(compositeKey, entry.name);
    }
  }
}

export function validateRegistry<T extends RegistryEntry>(registry: Registry<T>): void {
  const issues: string[] = [];

  for (const entry of registry.entries) {
    validateEntryFields(entry, issues);
    validateEntryChainId(entry, issues);
    validateEntryAddress(entry, issues);
  }

  validateNoDuplicateAddressRole(registry.entries, issues);

  if (issues.length > 0) {
    throw new RegistryValidationError(registry.name, issues);
  }
}

export function findEntry<T extends RegistryEntry>(
  registry: Registry<T>,
  predicate: (entry: T) => boolean,
): T | undefined {
  return registry.entries.find(predicate);
}

export function findEntries<T extends RegistryEntry>(
  registry: Registry<T>,
  predicate: (entry: T) => boolean,
): T[] {
  return registry.entries.filter(predicate);
}

export function findEnabledEntries<T extends RegistryEntry>(
  registry: Registry<T>,
  predicate: (entry: T) => boolean,
): T[] {
  return registry.entries.filter((e) => e.enabled && predicate(e));
}

export function getEntryByAddress<T extends RegistryEntry>(
  registry: Registry<T>,
  address: string,
  chainId?: SupportedChainId,
): T | undefined {
  const normalizedAddress = address.toLowerCase();
  return registry.entries.find(
    (e) =>
      e.address.toLowerCase() === normalizedAddress &&
      (chainId === undefined || e.chainId === chainId),
  );
}

export function getEnabledEntries<T extends RegistryEntry>(registry: Registry<T>): T[] {
  return registry.entries.filter((e) => e.enabled);
}

export function getEntriesByChainId<T extends RegistryEntry>(
  registry: Registry<T>,
  chainId: SupportedChainId,
): T[] {
  return registry.entries.filter((e) => e.chainId === chainId);
}
