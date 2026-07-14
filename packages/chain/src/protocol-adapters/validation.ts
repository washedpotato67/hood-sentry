import { getAddress, isAddress, isHash, keccak256, stringToHex, toHex, zeroAddress } from 'viem';
import { z } from 'zod';
import { UnverifiedProtocolContractError } from './errors.js';
import type {
  ProtocolContractConfig,
  ProtocolContractValidation,
  ProtocolDefinition,
  ProtocolOperationalAlert,
  ProtocolValidationClient,
  ProtocolValidationFailureCode,
  ProtocolValidationResult,
  VersionedProtocolRegistry,
} from './types.js';

const addressSchema = z
  .string()
  .refine(isAddress, 'Invalid EVM address')
  .transform((address) => getAddress(address));
const hashSchema = z.string().refine(isHash, 'Invalid bytecode hash');
const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith('https://'));
const isoDateSchema = z.string().datetime({ offset: true });

export const protocolContractConfigSchema = z
  .object({
    protocolKey: z.string().trim().min(1),
    protocolName: z.string().trim().min(1),
    protocolVersion: z.string().trim().min(1),
    chainId: z.number().int().positive().safe(),
    contractRole: z.enum([
      'factory',
      'router',
      'quoter',
      'positionManager',
      'permit2',
      'bondingCurve',
      'tokenFactory',
      'migration',
      'feeCollector',
    ]),
    address: addressSchema,
    officialSourceUrl: httpsUrlSchema,
    explorerUrl: httpsUrlSchema,
    verifiedAt: isoDateSchema,
    runtimeBytecodeHash: hashSchema,
    proxyType: z.string().trim().min(1).optional(),
    implementationAddress: addressSchema.optional(),
    adminAddress: addressSchema.optional(),
    enabled: z.boolean(),
    notes: z.string().optional(),
  })
  .superRefine((config, context) => {
    if (config.address.toLowerCase() === zeroAddress) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Zero address is forbidden' });
    }
    if (config.proxyType !== undefined && config.implementationAddress === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Proxy entries require an implementation address',
      });
    }
  });

export const protocolDefinitionSchema = z.object({
  protocolKey: z.string().trim().min(1),
  protocolName: z.string().trim().min(1),
  protocolVersion: z.string().trim().min(1),
  chainId: z.number().int().positive().safe(),
  kind: z.enum(['dex', 'launchpad']),
  enabled: z.boolean(),
  contracts: z.array(protocolContractConfigSchema),
});

export const versionedProtocolRegistrySchema = z.object({
  name: z.string().trim().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  createdAt: isoDateSchema,
  protocols: z.array(protocolDefinitionSchema),
});

export class ProtocolRegistryValidationError extends Error {
  constructor(public readonly issues: readonly string[]) {
    super(`Protocol registry validation failed: ${issues.join(', ')}`);
    this.name = 'ProtocolRegistryValidationError';
  }
}

function validateDefinitionConsistency(definition: ProtocolDefinition, issues: string[]): void {
  const roles = new Map<string, ProtocolContractConfig>();
  const addresses = new Map<string, ProtocolContractConfig>();

  for (const contract of definition.contracts) {
    if (
      contract.protocolKey !== definition.protocolKey ||
      contract.protocolName !== definition.protocolName ||
      contract.protocolVersion !== definition.protocolVersion ||
      contract.chainId !== definition.chainId
    ) {
      issues.push(`${definition.protocolKey} has a contract outside its protocol identity`);
    }
    const previousRole = roles.get(contract.contractRole);
    if (previousRole !== undefined) {
      issues.push(
        `${definition.protocolKey} ${definition.protocolVersion} has duplicate ${contract.contractRole} roles`,
      );
    } else {
      roles.set(contract.contractRole, contract);
    }
    const addressKey = contract.address.toLowerCase();
    const previousAddress = addresses.get(addressKey);
    if (previousAddress !== undefined && previousAddress.contractRole !== contract.contractRole) {
      issues.push(
        `${definition.protocolKey} assigns ${contract.address} to conflicting protocol roles`,
      );
    } else {
      addresses.set(addressKey, contract);
    }
  }
}

export function validateProtocolRegistry(
  registry: VersionedProtocolRegistry,
): VersionedProtocolRegistry {
  const parsed = versionedProtocolRegistrySchema.safeParse(registry);
  if (!parsed.success) {
    throw new ProtocolRegistryValidationError(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  const normalized = parsed.data;
  const issues: string[] = [];
  const protocolKeys = new Set<string>();

  for (const definition of normalized.protocols) {
    const key = `${definition.chainId}:${definition.protocolKey}:${definition.protocolVersion}`;
    if (protocolKeys.has(key)) {
      issues.push(`Duplicate protocol definition ${key}`);
    }
    protocolKeys.add(key);
    validateDefinitionConsistency(definition, issues);
  }
  if (issues.length > 0) throw new ProtocolRegistryValidationError(issues);
  return normalized;
}

function eip1967Slot(label: string): `0x${string}` {
  return toHex(BigInt(keccak256(stringToHex(label))) - 1n, { size: 32 });
}

const IMPLEMENTATION_SLOT = eip1967Slot('eip1967.proxy.implementation');
const ADMIN_SLOT = eip1967Slot('eip1967.proxy.admin');

function storageAddress(value: `0x${string}` | undefined): `0x${string}` | null {
  if (value === undefined || value === '0x' || BigInt(value) === 0n) return null;
  return getAddress(`0x${value.slice(-40)}`);
}

export interface ProtocolValidationServiceOptions {
  cacheTtlMs?: number;
  revalidationIntervalMs?: number;
  now?: () => Date;
  onAlert?: (alert: ProtocolOperationalAlert) => void | Promise<void>;
}

export class ProtocolValidationService {
  private readonly registry: VersionedProtocolRegistry;
  private readonly results = new Map<string, ProtocolValidationResult>();
  private readonly cacheTtlMs: number;
  private readonly revalidationIntervalMs: number;
  private readonly now: () => Date;
  private readonly onAlert?: (alert: ProtocolOperationalAlert) => void | Promise<void>;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    registry: VersionedProtocolRegistry,
    private readonly client: ProtocolValidationClient,
    options: ProtocolValidationServiceOptions = {},
  ) {
    this.registry = validateProtocolRegistry(registry);
    this.cacheTtlMs = options.cacheTtlMs ?? 300_000;
    this.revalidationIntervalMs = options.revalidationIntervalMs ?? 300_000;
    this.now = options.now ?? (() => new Date());
    this.onAlert = options.onAlert;
  }

  async initialize(): Promise<readonly ProtocolValidationResult[]> {
    const results: ProtocolValidationResult[] = [];
    for (const definition of this.registry.protocols) {
      results.push(await this.validateDefinition(definition));
    }
    return results;
  }

  startPeriodicRevalidation(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.revalidateAll();
    }, this.revalidationIntervalMs);
  }

  stopPeriodicRevalidation(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async revalidateAll(): Promise<readonly ProtocolValidationResult[]> {
    const results: ProtocolValidationResult[] = [];
    for (const definition of this.registry.protocols) {
      results.push(await this.validateDefinition(definition));
    }
    return results;
  }

  async getValidation(
    protocolKey: string,
    protocolVersion: string,
    chainId: number,
  ): Promise<ProtocolValidationResult> {
    const key = this.key(protocolKey, protocolVersion, chainId);
    const cached = this.results.get(key);
    if (cached !== undefined && new Date(cached.expiresAt).getTime() > this.now().getTime()) {
      return cached;
    }
    const definition = this.registry.protocols.find(
      (candidate) =>
        candidate.protocolKey === protocolKey &&
        candidate.protocolVersion === protocolVersion &&
        candidate.chainId === chainId,
    );
    if (definition === undefined) {
      throw new UnverifiedProtocolContractError(`Unknown protocol ${key}`);
    }
    return this.validateDefinition(definition);
  }

  async assertActive(
    protocolKey: string,
    protocolVersion: string,
    chainId: number,
  ): Promise<ProtocolValidationResult> {
    const result = await this.getValidation(protocolKey, protocolVersion, chainId);
    if (!result.active) {
      throw new UnverifiedProtocolContractError(
        `${protocolKey} ${protocolVersion} is disabled: ${result.errors.join(', ')}`,
      );
    }
    return result;
  }

  getCachedResults(): readonly ProtocolValidationResult[] {
    return [...this.results.values()];
  }

  private async validateDefinition(
    definition: ProtocolDefinition,
  ): Promise<ProtocolValidationResult> {
    const checkedAt = this.now();
    if (!definition.enabled) {
      return this.saveResult(definition, checkedAt, false, null, ['Protocol is disabled'], []);
    }
    const chainFailure = await this.validateChain(definition, checkedAt);
    if (chainFailure !== null) return chainFailure;

    const contracts: ProtocolContractValidation[] = [];
    for (const config of definition.contracts.filter((contract) => contract.enabled)) {
      contracts.push(await this.validateContract(config));
    }
    if (contracts.length === 0) {
      return this.failure(
        definition,
        checkedAt,
        'invalid-configuration',
        'No enabled protocol contracts are configured',
        contracts,
      );
    }
    const contractErrors = contracts.flatMap((contract) => contract.errors);
    if (contractErrors.length > 0) {
      return this.failure(
        definition,
        checkedAt,
        this.failureCode(contractErrors),
        contractErrors.join(', '),
        contracts,
      );
    }
    return this.saveResult(definition, checkedAt, true, null, [], contracts);
  }

  private async validateContract(
    config: ProtocolContractConfig,
  ): Promise<ProtocolContractValidation> {
    const errors: string[] = [];
    const observedRuntimeBytecodeHash = await this.observeRuntimeBytecode(config, errors);
    const proxy =
      config.proxyType === undefined
        ? { implementation: null, admin: null }
        : await this.observeProxy(config, errors);
    return {
      config,
      valid: errors.length === 0,
      observedRuntimeBytecodeHash,
      observedImplementationAddress: proxy.implementation,
      observedAdminAddress: proxy.admin,
      errors,
    };
  }

  private async validateChain(
    definition: ProtocolDefinition,
    checkedAt: Date,
  ): Promise<ProtocolValidationResult | null> {
    let observedChainId: number;
    try {
      observedChainId = await this.client.getChainId();
    } catch (error) {
      return this.failure(
        definition,
        checkedAt,
        'provider-outage',
        error instanceof Error ? error.message : String(error),
        [],
      );
    }
    if (observedChainId === definition.chainId) return null;
    return this.failure(
      definition,
      checkedAt,
      'wrong-chain',
      `RPC chain ${observedChainId} does not match ${definition.chainId}`,
      [],
    );
  }

  private failureCode(errors: readonly string[]): ProtocolValidationFailureCode {
    if (errors.some((error) => error.includes('bytecode hash'))) return 'bytecode-mismatch';
    if (errors.some((error) => error.includes('proxy'))) return 'proxy-mismatch';
    if (errors.some((error) => error.includes('unavailable'))) return 'provider-outage';
    return 'missing-bytecode';
  }

  private async observeRuntimeBytecode(
    config: ProtocolContractConfig,
    errors: string[],
  ): Promise<ProtocolContractValidation['observedRuntimeBytecodeHash']> {
    let code: `0x${string}` | undefined;
    try {
      code = await this.client.getBytecode(config.address);
    } catch (error) {
      errors.push(
        `Runtime bytecode unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const observedRuntimeBytecodeHash =
      code === undefined || code === '0x' ? null : keccak256(code);
    if (observedRuntimeBytecodeHash === null) {
      errors.push('Runtime bytecode is missing');
    } else if (observedRuntimeBytecodeHash !== config.runtimeBytecodeHash) {
      errors.push('Runtime bytecode hash differs from the verified registry');
    }
    return observedRuntimeBytecodeHash;
  }

  private async observeProxy(
    config: ProtocolContractConfig,
    errors: string[],
  ): Promise<{
    implementation: ProtocolContractValidation['observedImplementationAddress'];
    admin: ProtocolContractValidation['observedAdminAddress'];
  }> {
    let implementation: ProtocolContractValidation['observedImplementationAddress'] = null;
    let admin: ProtocolContractValidation['observedAdminAddress'] = null;
    try {
      const [implementationSlot, adminSlot] = await Promise.all([
        this.client.getStorageAt(config.address, IMPLEMENTATION_SLOT),
        this.client.getStorageAt(config.address, ADMIN_SLOT),
      ]);
      implementation = storageAddress(implementationSlot);
      admin = storageAddress(adminSlot);
    } catch (error) {
      errors.push(
        `Proxy state unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (implementation?.toLowerCase() !== config.implementationAddress?.toLowerCase()) {
      errors.push('Observed proxy implementation differs from the verified registry');
    }
    if (
      config.adminAddress !== undefined &&
      admin?.toLowerCase() !== config.adminAddress.toLowerCase()
    ) {
      errors.push('Observed proxy admin differs from the verified registry');
    }
    return { implementation, admin };
  }

  private async emitAlert(
    definition: ProtocolDefinition,
    code: ProtocolValidationFailureCode,
    message: string,
    checkedAt: Date,
  ): Promise<void> {
    await this.onAlert?.({
      severity: code === 'provider-outage' ? 'warning' : 'critical',
      code,
      protocolKey: definition.protocolKey,
      protocolVersion: definition.protocolVersion,
      chainId: definition.chainId,
      message,
      observedAt: checkedAt.toISOString(),
    });
  }

  private async failure(
    definition: ProtocolDefinition,
    checkedAt: Date,
    code: ProtocolValidationFailureCode,
    message: string,
    contracts: readonly ProtocolContractValidation[],
  ): Promise<ProtocolValidationResult> {
    await this.emitAlert(definition, code, message, checkedAt);
    return this.saveResult(definition, checkedAt, false, code, [message], contracts);
  }

  private saveResult(
    definition: ProtocolDefinition,
    checkedAt: Date,
    active: boolean,
    failureCode: ProtocolValidationFailureCode | null,
    errors: readonly string[],
    contracts: readonly ProtocolContractValidation[],
  ): ProtocolValidationResult {
    const result: ProtocolValidationResult = {
      protocolKey: definition.protocolKey,
      protocolName: definition.protocolName,
      protocolVersion: definition.protocolVersion,
      chainId: definition.chainId,
      kind: definition.kind,
      active,
      checkedAt: checkedAt.toISOString(),
      expiresAt: new Date(checkedAt.getTime() + this.cacheTtlMs).toISOString(),
      failureCode,
      errors,
      contracts,
    };
    this.results.set(
      this.key(definition.protocolKey, definition.protocolVersion, definition.chainId),
      result,
    );
    return result;
  }

  private key(protocolKey: string, protocolVersion: string, chainId: number): string {
    return `${chainId}:${protocolKey}:${protocolVersion}`;
  }
}
