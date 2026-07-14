import { getAddress } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import {
  BlockscoutClient,
  InMemoryBlockscoutCache,
  reconcileBlockscoutProxyMetadata,
} from '../blockscout/index.js';
import type { BlockscoutRateLimitGate } from '../blockscout/index.js';

const ADDRESS = getAddress('0x1111111111111111111111111111111111111111');
const IMPLEMENTATION = getAddress('0x2222222222222222222222222222222222222222');
const OTHER_IMPLEMENTATION = getAddress('0x3333333333333333333333333333333333333333');
const ADMIN = getAddress('0x4444444444444444444444444444444444444444');

const noRateLimit: BlockscoutRateLimitGate = { acquire: async () => undefined };

function jsonResponse(value: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function verifiedContract(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    is_verified: true,
    is_fully_verified: true,
    source_code: 'contract Vault {\u0000 function balance() external view returns (uint256) {} }',
    file_path: 'src\\Vault.sol',
    additional_sources: [{ file_path: 'src/IVault.sol', source_code: 'interface IVault {}' }],
    abi: JSON.stringify([
      {
        type: 'function',
        name: 'balance',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: '', type: 'uint256' }],
      },
    ]),
    compiler_version: 'v0.8.28+commit.7893614a',
    optimization_enabled: true,
    optimizations_runs: 200,
    compiler_settings: { optimizer: { enabled: true, runs: 200 } },
    constructor_args: '00000001',
    name: 'Vault',
    proxy_type: 'eip1967',
    implementations: [{ address_hash: IMPLEMENTATION }],
    proxy_admin_address_hash: ADMIN,
    ...overrides,
  };
}

function addressMetadata(): Record<string, unknown> {
  return {
    public_tags: [{ label: 'Official Vault' }],
    token: { name: 'Vault Token', symbol: 'VLT' },
    implementations: [{ address_hash: IMPLEMENTATION }],
  };
}

function createClient(
  fetchImplementation: typeof globalThis.fetch,
  options: Record<string, unknown> = {},
) {
  return new BlockscoutClient({
    apiBaseUrl: 'https://example.blockscout.test/api',
    fetch: fetchImplementation,
    rateLimitGate: noRateLimit,
    retryBaseDelayMs: 1,
    sleep: async () => undefined,
    ...options,
  });
}

describe('BlockscoutClient', () => {
  it('returns verified source metadata with provenance and a stable source hash', async () => {
    const fetchImplementation = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(verifiedContract()))
      .mockResolvedValueOnce(jsonResponse(addressMetadata()));

    const result = await createClient(fetchImplementation).enrichContract(46630, ADDRESS);

    expect(result.status).toBe('available');
    expect(result.metadata).toMatchObject({
      address: ADDRESS,
      verified: true,
      verificationStatus: 'fully_verified',
      compilerVersion: 'v0.8.28+commit.7893614a',
      optimizerEnabled: true,
      optimizerRuns: 200,
      constructorArguments: '00000001',
      contractName: 'Vault',
      tokenLabels: { name: 'Vault Token', symbol: 'VLT', publicTags: ['Official Vault'] },
      provenance: { provider: 'blockscout', providerUrl: 'https://example.blockscout.test' },
    });
    expect(result.metadata?.sourceFiles).toHaveLength(2);
    expect(result.metadata?.sourceFiles[0]?.path).toBe('src/Vault.sol');
    expect(result.metadata?.sourceFiles[0]?.source).not.toContain('\u0000');
    expect(result.metadata?.sourceHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.metadata?.abi?.[0]?.name).toBe('balance');
    expect(result.metadata?.provenance.fetchedAt).toBeTruthy();
  });

  it('represents a missing smart-contract record as unverified metadata', async () => {
    const fetchImplementation = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({ message: 'not found' }, 404))
      .mockResolvedValueOnce(jsonResponse(addressMetadata()));

    const result = await createClient(fetchImplementation).enrichContract(46630, ADDRESS);

    expect(result.status).toBe('available');
    expect(result.metadata?.verified).toBe(false);
    expect(result.metadata?.sourceFiles).toEqual([]);
    expect(result.metadata?.sourceHash).toBeNull();
  });

  it('rejects a malformed ABI while preserving other explorer metadata', async () => {
    const fetchImplementation = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(verifiedContract({ abi: '[{"type":"function"}]' })))
      .mockResolvedValueOnce(jsonResponse(addressMetadata()));

    const result = await createClient(fetchImplementation).enrichContract(46630, ADDRESS);

    expect(result.status).toBe('available');
    expect(result.metadata?.abi).toBeNull();
    expect(result.metadata?.contractName).toBe('Vault');
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'ABI_MALFORMED', provider: 'blockscout' }),
    );
  });

  it('retries a provider rate limit using Retry-After', async () => {
    const fetchImplementation = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({}, 429, { 'retry-after': '0' }))
      .mockResolvedValueOnce(jsonResponse(verifiedContract()))
      .mockResolvedValueOnce(jsonResponse(addressMetadata()));

    const result = await createClient(fetchImplementation).enrichContract(46630, ADDRESS);

    expect(result.status).toBe('available');
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
  });

  it('returns an unavailable result after a provider outage', async () => {
    const fetchImplementation = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new TypeError('network unavailable'));

    const result = await createClient(fetchImplementation, { maxAttempts: 2 }).enrichContract(
      46630,
      ADDRESS,
    );

    expect(result).toMatchObject({ status: 'unavailable', metadata: null, cacheStatus: 'miss' });
    expect(result.warnings[0]?.code).toBe('PROVIDER_UNAVAILABLE');
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it('aborts a provider request after the configured timeout', async () => {
    const fetchImplementation = vi.fn<typeof globalThis.fetch>((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    });

    const result = await createClient(fetchImplementation, {
      maxAttempts: 1,
      timeoutMs: 5,
    }).enrichContract(46630, ADDRESS);

    expect(result.status).toBe('unavailable');
    expect(result.warnings[0]?.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('preserves proxy disagreement and prefers direct chain values', async () => {
    const fetchImplementation = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(verifiedContract()))
      .mockResolvedValueOnce(jsonResponse(addressMetadata()));
    const result = await createClient(fetchImplementation).enrichContract(46630, ADDRESS);
    const metadata = result.metadata;
    expect(metadata).not.toBeNull();
    if (metadata === null) return;

    const reconciled = reconcileBlockscoutProxyMetadata(
      { implementationAddress: OTHER_IMPLEMENTATION, adminAddress: ADMIN },
      metadata,
    );

    expect(reconciled.current.implementationAddress).toBe(OTHER_IMPLEMENTATION);
    expect(reconciled.explorer.implementationAddresses[0]).toBe(IMPLEMENTATION);
    expect(reconciled.conflicts).toHaveLength(1);
    expect(reconciled.dataQualityWarnings[0]?.conflict.field).toBe('implementation_address');
  });

  it('rejects a source response over the configured raw response limit', async () => {
    const fetchImplementation = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(jsonResponse(verifiedContract({ source_code: 'x'.repeat(2_000) })));

    const result = await createClient(fetchImplementation, {
      maxRawResponseBytes: 1_000,
    }).enrichContract(46630, ADDRESS);

    expect(result.status).toBe('unavailable');
    expect(result.warnings[0]?.code).toBe('RAW_RESPONSE_TOO_LARGE');
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it('refreshes stale cache entries and falls back to stale data during an outage', async () => {
    const cache = new InMemoryBlockscoutCache();
    let currentTime = new Date('2026-07-14T10:00:00.000Z');
    const fetchImplementation = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(verifiedContract()))
      .mockResolvedValueOnce(jsonResponse(addressMetadata()));
    const client = createClient(fetchImplementation, {
      cache,
      cacheTtlMs: 1_000,
      now: () => currentTime,
      maxAttempts: 1,
    });

    const first = await client.enrichContract(46630, ADDRESS);
    currentTime = new Date('2026-07-14T10:00:02.000Z');
    fetchImplementation.mockRejectedValueOnce(new TypeError('provider offline'));
    const stale = await client.enrichContract(46630, ADDRESS);

    expect(first.cacheStatus).toBe('miss');
    expect(stale.status).toBe('available');
    expect(stale.cacheStatus).toBe('stale');
    expect(stale.metadata?.provenance.fetchedAt).toBe('2026-07-14T10:00:00.000Z');
    expect(stale.warnings.at(-1)?.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('replaces a stale cache entry after a successful refresh', async () => {
    const cache = new InMemoryBlockscoutCache();
    let currentTime = new Date('2026-07-14T10:00:00.000Z');
    const fetchImplementation = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(verifiedContract()))
      .mockResolvedValueOnce(jsonResponse(addressMetadata()))
      .mockResolvedValueOnce(jsonResponse(verifiedContract({ name: 'VaultV2' })))
      .mockResolvedValueOnce(jsonResponse(addressMetadata()));
    const client = createClient(fetchImplementation, {
      cache,
      cacheTtlMs: 1_000,
      now: () => currentTime,
    });

    await client.enrichContract(46630, ADDRESS);
    currentTime = new Date('2026-07-14T10:00:02.000Z');
    const refreshed = await client.enrichContract(46630, ADDRESS);

    expect(refreshed.cacheStatus).toBe('refreshed');
    expect(refreshed.metadata?.contractName).toBe('VaultV2');
    expect(refreshed.metadata?.provenance.fetchedAt).toBe('2026-07-14T10:00:02.000Z');
    expect(fetchImplementation).toHaveBeenCalledTimes(4);
  });
});
