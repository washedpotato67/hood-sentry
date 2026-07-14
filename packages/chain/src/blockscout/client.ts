import { getAddress, keccak256, toBytes } from 'viem';
import { z } from 'zod';
import { InMemoryBlockscoutCache } from './cache.js';
import { BlockscoutRateLimiter } from './rate-limiter.js';
import type {
  BlockscoutAbiItem,
  BlockscoutAbiParameter,
  BlockscoutCache,
  BlockscoutClientOptions,
  BlockscoutContractMetadata,
  BlockscoutEnrichmentResult,
  BlockscoutRateLimitGate,
  BlockscoutSourceFile,
  BlockscoutWarning,
} from './types.js';

const addressPattern = /^0x[0-9a-fA-F]{40}$/;

const enrichmentRequestSchema = z.object({
  chainId: z.number().int().positive().safe(),
  address: z
    .string()
    .regex(addressPattern)
    .transform((address) => getAddress(address)),
});

const abiParameterSchema: z.ZodType<BlockscoutAbiParameter> = z.lazy(() =>
  z.object({
    name: z.string().optional(),
    type: z.string().min(1),
    internalType: z.string().optional(),
    indexed: z.boolean().optional(),
    components: z.array(abiParameterSchema).optional(),
  }),
);

const abiItemSchema = z
  .object({
    type: z.enum(['constructor', 'error', 'event', 'fallback', 'function', 'receive']),
    name: z.string().optional(),
    stateMutability: z.enum(['pure', 'view', 'nonpayable', 'payable']).optional(),
    anonymous: z.boolean().optional(),
    inputs: z.array(abiParameterSchema).optional(),
    outputs: z.array(abiParameterSchema).optional(),
  })
  .superRefine((item, context) => {
    if (['error', 'event', 'function'].includes(item.type) && !item.name) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${item.type} ABI item needs a name`,
      });
    }
  });

const smartContractSchema = z.object({
  is_verified: z.boolean().optional().default(false),
  is_fully_verified: z.boolean().nullable().optional(),
  is_partially_verified: z.boolean().nullable().optional(),
  source_code: z.string().nullable().optional(),
  file_path: z.string().nullable().optional(),
  additional_sources: z
    .array(z.object({ source_code: z.string(), file_path: z.string().nullable().optional() }))
    .nullable()
    .optional(),
  abi: z.unknown().nullable().optional(),
  compiler_version: z.string().nullable().optional(),
  optimization_enabled: z.boolean().nullable().optional(),
  optimizations_runs: z.number().int().nonnegative().nullable().optional(),
  optimization_runs: z.number().int().nonnegative().nullable().optional(),
  compiler_settings: z.record(z.unknown()).nullable().optional(),
  constructor_args: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  proxy_type: z.string().nullable().optional(),
  implementations: z
    .array(z.object({ address_hash: z.string().regex(addressPattern) }))
    .nullable()
    .optional(),
  implementation_address_hash: z.string().regex(addressPattern).nullable().optional(),
  proxy_admin_address_hash: z.string().regex(addressPattern).nullable().optional(),
  minimal_proxy_address_hash: z.string().regex(addressPattern).nullable().optional(),
});

const addressResponseSchema = z.object({
  proxy_type: z.string().nullable().optional(),
  implementations: z
    .array(z.object({ address_hash: z.string().regex(addressPattern) }))
    .nullable()
    .optional(),
  public_tags: z
    .array(z.object({ label: z.string().optional(), name: z.string().optional() }))
    .nullable()
    .optional(),
  token: z
    .object({ name: z.string().nullable().optional(), symbol: z.string().nullable().optional() })
    .nullable()
    .optional(),
});

class HttpResponseError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | null,
  ) {
    super(`Blockscout returned HTTP ${status}`);
    this.name = 'HttpResponseError';
  }
}

class RawResponseTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`Blockscout response exceeded ${limit} bytes`);
    this.name = 'RawResponseTooLargeError';
  }
}

interface FetchResult {
  value: unknown;
  endpoint: string;
}

function sanitizeText(value: string, maxLength = 1_000_000): string {
  return [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join('')
    .slice(0, maxLength);
}

function sanitizePath(value: string): string {
  return sanitizeText(value, 1_024).replace(/\\/g, '/');
}

function sanitizeJson(value: unknown, depth = 0): unknown {
  if (depth > 20) {
    return '[depth limit]';
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return sanitizeText(value);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 10_000).map((entry) => sanitizeJson(entry, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 10_000)
        .map(([key, entry]) => [sanitizeText(key, 256), sanitizeJson(entry, depth + 1)]),
    );
  }
  return null;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRetryAfter(value: string | null, now: Date): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now.getTime());
}

function normalizeApiRoot(apiBaseUrl: string): string {
  const url = new URL(apiBaseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Blockscout API base must use HTTP without embedded credentials');
  }
  url.pathname = url.pathname.replace(/\/$/, '').replace(/\/api$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function parseAbi(value: unknown): BlockscoutAbiItem[] | null {
  if (value === null || value === undefined) return null;
  let candidate: unknown = value;
  if (typeof value === 'string') {
    candidate = JSON.parse(value);
  }
  return z.array(abiItemSchema).parse(candidate);
}

function uniqueAddresses(values: string[]): string[] {
  return [...new Set(values.map((value) => getAddress(value)))];
}

function sourceHash(files: BlockscoutSourceFile[]): string | null {
  if (files.length === 0) return null;
  const canonical = [...files]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => `${file.path}\u0000${file.source}`)
    .join('\u0000');
  return keccak256(toBytes(canonical));
}

type SmartContractResponse = z.infer<typeof smartContractSchema>;
type AddressResponse = z.infer<typeof addressResponseSchema>;

function parseAbiWithWarnings(value: unknown): {
  abi: BlockscoutAbiItem[] | null;
  warnings: BlockscoutWarning[];
} {
  try {
    return { abi: parseAbi(value), warnings: [] };
  } catch {
    return {
      abi: null,
      warnings: [
        {
          code: 'ABI_MALFORMED',
          message: 'Blockscout returned an ABI which failed structural validation',
          provider: 'blockscout',
        },
      ],
    };
  }
}

function buildSourceFiles(contract: SmartContractResponse): BlockscoutSourceFile[] {
  const sourceFiles: BlockscoutSourceFile[] = [];
  if (contract.source_code) {
    sourceFiles.push({
      path: sanitizePath(contract.file_path ?? 'Contract.sol'),
      source: sanitizeText(contract.source_code),
    });
  }
  for (const source of contract.additional_sources ?? []) {
    sourceFiles.push({
      path: sanitizePath(source.file_path ?? `AdditionalSource${sourceFiles.length}.sol`),
      source: sanitizeText(source.source_code),
    });
  }
  return sourceFiles;
}

function getVerificationStatus(
  contract: SmartContractResponse,
): BlockscoutContractMetadata['verificationStatus'] {
  if (contract.is_fully_verified) return 'fully_verified';
  if (contract.is_partially_verified) return 'partially_verified';
  return contract.is_verified ? 'verified' : 'unverified';
}

function sanitizeCompilerSettings(
  settings: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (settings === null || settings === undefined) return null;
  const sanitized = sanitizeJson(settings);
  return isUnknownRecord(sanitized) ? sanitized : null;
}

interface MetadataInput {
  chainId: number;
  address: string;
  contract: SmartContractResponse;
  addressData: AddressResponse;
  abi: BlockscoutAbiItem[] | null;
  rawResponse: Record<string, unknown>;
  apiRoot: string;
  endpoints: string[];
  fetchedAt: Date;
}

function buildMetadata(input: MetadataInput): BlockscoutContractMetadata {
  const { contract, addressData } = input;
  const sourceFiles = buildSourceFiles(contract);
  const implementations = uniqueAddresses([
    ...(contract.implementations ?? []).map((entry) => entry.address_hash),
    ...(addressData.implementations ?? []).map((entry) => entry.address_hash),
    ...(contract.implementation_address_hash ? [contract.implementation_address_hash] : []),
  ]);
  const tags = (addressData.public_tags ?? [])
    .map((tag) => tag.label ?? tag.name)
    .filter((tag): tag is string => tag !== undefined)
    .map((tag) => sanitizeText(tag, 256));

  return {
    chainId: input.chainId,
    address: input.address,
    verified: contract.is_verified,
    verificationStatus: getVerificationStatus(contract),
    sourceFiles,
    sourceHash: sourceHash(sourceFiles),
    abi: input.abi,
    compilerVersion: contract.compiler_version
      ? sanitizeText(contract.compiler_version, 128)
      : null,
    optimizerEnabled: contract.optimization_enabled ?? null,
    optimizerRuns: contract.optimizations_runs ?? contract.optimization_runs ?? null,
    compilerSettings: sanitizeCompilerSettings(contract.compiler_settings),
    constructorArguments: contract.constructor_args
      ? sanitizeText(contract.constructor_args, 100_000)
      : null,
    contractName: contract.name ? sanitizeText(contract.name, 256) : null,
    proxy: {
      proxyType: sanitizeText(contract.proxy_type ?? addressData.proxy_type ?? '', 64) || null,
      implementationAddresses: implementations,
      adminAddress: contract.proxy_admin_address_hash
        ? getAddress(contract.proxy_admin_address_hash)
        : null,
      minimalProxyAddress: contract.minimal_proxy_address_hash
        ? getAddress(contract.minimal_proxy_address_hash)
        : null,
    },
    tokenLabels: {
      name: addressData.token?.name ? sanitizeText(addressData.token.name, 256) : null,
      symbol: addressData.token?.symbol ? sanitizeText(addressData.token.symbol, 64) : null,
      publicTags: [...new Set(tags)],
    },
    rawResponse: input.rawResponse,
    provenance: {
      provider: 'blockscout',
      providerUrl: input.apiRoot,
      endpoints: input.endpoints,
      fetchedAt: input.fetchedAt.toISOString(),
    },
  };
}

export class BlockscoutClient {
  private readonly apiRoot: string;
  private readonly cache: BlockscoutCache;
  private readonly cacheTtlMs: number;
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly maxAttempts: number;
  private readonly maxRawResponseBytes: number;
  private readonly now: () => Date;
  private readonly retryBaseDelayMs: number;
  private readonly rateLimitGate: BlockscoutRateLimitGate;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly timeoutMs: number;

  constructor(options: BlockscoutClientOptions) {
    this.apiRoot = normalizeApiRoot(options.apiBaseUrl);
    this.cache = options.cache ?? new InMemoryBlockscoutCache();
    this.cacheTtlMs = options.cacheTtlMs ?? 6 * 60 * 60 * 1000;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.maxRawResponseBytes = options.maxRawResponseBytes ?? 1_000_000;
    this.now = options.now ?? (() => new Date());
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 250;
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.rateLimitGate =
      options.rateLimitGate ??
      new BlockscoutRateLimiter(options.requestsPerSecond ?? 3, { sleep: this.sleep });
    this.timeoutMs = options.timeoutMs ?? 5_000;

    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts <= 0) {
      throw new Error('Blockscout max attempts must be a positive integer');
    }
    if (!Number.isFinite(this.cacheTtlMs) || this.cacheTtlMs <= 0) {
      throw new Error('Blockscout cache TTL must be greater than zero');
    }
    if (!Number.isInteger(this.maxRawResponseBytes) || this.maxRawResponseBytes <= 0) {
      throw new Error('Blockscout response limit must be a positive integer');
    }
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('Blockscout timeout must be greater than zero');
    }
    if (!Number.isFinite(this.retryBaseDelayMs) || this.retryBaseDelayMs < 0) {
      throw new Error('Blockscout retry delay cannot be negative');
    }
  }

  async enrichContract(chainId: number, address: string): Promise<BlockscoutEnrichmentResult> {
    const request = enrichmentRequestSchema.parse({ chainId, address });
    const key = `blockscout:${request.chainId}:${request.address.toLowerCase()}`;
    const cached = await this.cache.get(key);
    const now = this.now();

    if (cached !== null && Date.parse(cached.expiresAt) > now.getTime()) {
      return { ...cached.result, cacheStatus: 'fresh' };
    }

    try {
      const result = await this.fetchMetadata(request.chainId, request.address, now);
      const cacheStatus = cached === null ? 'miss' : 'refreshed';
      const available = { ...result, cacheStatus } satisfies BlockscoutEnrichmentResult;
      await this.cache.set(key, {
        result: available,
        expiresAt: new Date(now.getTime() + this.cacheTtlMs).toISOString(),
      });
      return available;
    } catch (error) {
      const warning = this.providerWarning(error);
      if (cached !== null) {
        return {
          ...cached.result,
          cacheStatus: 'stale',
          warnings: [...cached.result.warnings, warning],
        };
      }
      return { status: 'unavailable', metadata: null, warnings: [warning], cacheStatus: 'miss' };
    }
  }

  private async fetchMetadata(
    chainId: number,
    address: string,
    fetchedAt: Date,
  ): Promise<BlockscoutEnrichmentResult> {
    const contractEndpoint = `/api/v2/smart-contracts/${address}`;
    const addressEndpoint = `/api/v2/addresses/${address}`;
    const contractResponse = await this.fetchJson(contractEndpoint, true);
    const addressResponse = await this.fetchJson(addressEndpoint, true);
    const contract =
      contractResponse.value === null
        ? smartContractSchema.parse({ is_verified: false })
        : smartContractSchema.parse(contractResponse.value);
    const addressData =
      addressResponse.value === null
        ? addressResponseSchema.parse({})
        : addressResponseSchema.parse(addressResponse.value);
    const { abi, warnings } = parseAbiWithWarnings(contract.abi);
    const rawResponse = sanitizeJson({
      smartContract: contractResponse.value,
      address: addressResponse.value,
    });
    const metadata = buildMetadata({
      chainId,
      address,
      contract,
      addressData,
      abi,
      rawResponse: isUnknownRecord(rawResponse) ? rawResponse : {},
      apiRoot: this.apiRoot,
      endpoints: [contractEndpoint, addressEndpoint],
      fetchedAt,
    });

    return { status: 'available', metadata, warnings, cacheStatus: 'miss' };
  }

  private async fetchJson(endpoint: string, allowNotFound: boolean): Promise<FetchResult> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.fetchJsonAttempt(endpoint, allowNotFound);
      } catch (error) {
        lastError = error;
        if (!this.shouldRetry(error) || attempt === this.maxAttempts) throw error;
        const retryAfter = error instanceof HttpResponseError ? error.retryAfterMs : null;
        const retryDelay = retryAfter ?? this.retryBaseDelayMs * 2 ** (attempt - 1);
        await this.sleep(Math.min(retryDelay, 30_000));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Blockscout request failed');
  }

  private async fetchJsonAttempt(endpoint: string, allowNotFound: boolean): Promise<FetchResult> {
    await this.rateLimitGate.acquire();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImplementation(`${this.apiRoot}${endpoint}`, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (allowNotFound && response.status === 404) return { value: null, endpoint };
      if (!response.ok) {
        throw new HttpResponseError(
          response.status,
          parseRetryAfter(response.headers.get('retry-after'), this.now()),
        );
      }
      return { value: await this.readLimitedJson(response), endpoint };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readLimitedJson(response: Response): Promise<unknown> {
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > this.maxRawResponseBytes) {
      throw new RawResponseTooLargeError(this.maxRawResponseBytes);
    }
    if (response.body === null) return null;

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > this.maxRawResponseBytes) {
        await reader.cancel();
        throw new RawResponseTooLargeError(this.maxRawResponseBytes);
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  }

  private shouldRetry(error: unknown): boolean {
    if (error instanceof RawResponseTooLargeError) return false;
    if (error instanceof HttpResponseError) {
      return error.status === 408 || error.status === 429 || error.status >= 500;
    }
    return true;
  }

  private providerWarning(error: unknown): BlockscoutWarning {
    if (error instanceof RawResponseTooLargeError) {
      return {
        code: 'RAW_RESPONSE_TOO_LARGE',
        message: error.message,
        provider: 'blockscout',
      };
    }
    return {
      code: 'PROVIDER_UNAVAILABLE',
      message:
        error instanceof Error ? sanitizeText(error.message, 512) : 'Blockscout request failed',
      provider: 'blockscout',
    };
  }
}
