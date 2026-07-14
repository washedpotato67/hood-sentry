import {
  applicationContractRegistry,
  bridgeRegistry,
  canonicalAssetRegistry,
  chainlinkFeedRegistry,
  dexRegistry,
  quoteProviderRegistry,
  sequencerFeedRegistry,
  smartAccountRegistry,
  stockTokenRegistry,
} from './registries/index.js';
import { type RegistryValidationError, validateRegistry } from './registry.js';
import type { Registry, RegistryEntry } from './types.js';

export interface ValidationResult {
  registryName: string;
  valid: boolean;
  entryCount: number;
  enabledCount: number;
  errors: string[];
}

export function validateAllRegistries(): ValidationResult[] {
  const registries: Array<Registry<RegistryEntry>> = [
    canonicalAssetRegistry as unknown as Registry<RegistryEntry>,
    stockTokenRegistry as unknown as Registry<RegistryEntry>,
    applicationContractRegistry as unknown as Registry<RegistryEntry>,
    dexRegistry as unknown as Registry<RegistryEntry>,
    quoteProviderRegistry as unknown as Registry<RegistryEntry>,
    chainlinkFeedRegistry as unknown as Registry<RegistryEntry>,
    sequencerFeedRegistry as unknown as Registry<RegistryEntry>,
    smartAccountRegistry as unknown as Registry<RegistryEntry>,
    bridgeRegistry as unknown as Registry<RegistryEntry>,
  ];

  const results: ValidationResult[] = [];

  for (const registry of registries) {
    const result: ValidationResult = {
      registryName: registry.name,
      valid: true,
      entryCount: registry.entries.length,
      enabledCount: registry.entries.filter((e) => e.enabled).length,
      errors: [],
    };

    try {
      validateRegistry(registry);
    } catch (error) {
      result.valid = false;
      if (error instanceof Error && 'issues' in error) {
        result.errors = (error as RegistryValidationError).issues;
      } else {
        result.errors = [error instanceof Error ? error.message : String(error)];
      }
    }

    results.push(result);
  }

  return results;
}

export function assertRegistriesValid(): void {
  const results = validateAllRegistries();
  const failures = results.filter((r) => !r.valid);

  if (failures.length > 0) {
    const messages = failures.map(
      (f) => `Registry "${f.registryName}":\n${f.errors.map((e) => `  - ${e}`).join('\n')}`,
    );
    throw new Error(`Registry validation failed at startup:\n${messages.join('\n\n')}`);
  }
}
