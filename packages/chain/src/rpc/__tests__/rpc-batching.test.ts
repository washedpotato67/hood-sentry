import { afterEach, describe, expect, it, vi } from 'vitest';
import { getChainDefinition } from '../../chains.js';
import { RPCClient } from '../rpc-client.js';
import type { RPCClientConfig } from '../types.js';

const CHAIN_ID = 4663;

function baseConfig(batch: { maxCallsPerRequest: number } | undefined): RPCClientConfig {
  return {
    chainId: CHAIN_ID,
    primary: {
      url: 'https://rpc.test.invalid/v2/key',
      type: 'http',
      role: 'primary',
      timeout: 5_000,
      batch,
    },
    healthCheck: { intervalMs: 3_600_000, timeoutMs: 10_000, maxBlockLag: 100 },
    circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 30_000, halfOpenMaxRequests: 3 },
    retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1, backoffMultiplier: 1 },
  };
}

/**
 * Answers any batched or single JSON-RPC block-number request and records how
 * many HTTP requests were needed, which is the quantity the provider meters.
 */
function countingFetch(httpRequests: { count: number }): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    httpRequests.count += 1;
    const body = JSON.parse(String(init.body)) as { id: number } | Array<{ id: number }>;
    const answer = (request: { id: number }) => ({
      jsonrpc: '2.0',
      id: request.id,
      result: '0x60',
    });
    const payload = Array.isArray(body) ? body.map(answer) : answer(body);
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('rpc batching', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends concurrent calls as one HTTP request when batching is configured', async () => {
    const httpRequests = { count: 0 };
    vi.stubGlobal('fetch', countingFetch(httpRequests));
    const client = new RPCClient(
      getChainDefinition(CHAIN_ID),
      baseConfig({ maxCallsPerRequest: 10 }),
    );

    // Distinct addresses so viem cannot collapse these into one deduplicated
    // call: what is under test is batching, not request deduplication.
    await Promise.all(
      Array.from({ length: 10 }, (_unused, index) =>
        client.getCode(`0x${String(index).repeat(40)}` as `0x${string}`),
      ),
    );
    await client.disconnect();

    expect(httpRequests.count).toBe(1);
  });

  it('sends one HTTP request per call when batching is not configured', async () => {
    const httpRequests = { count: 0 };
    vi.stubGlobal('fetch', countingFetch(httpRequests));
    const client = new RPCClient(getChainDefinition(CHAIN_ID), baseConfig(undefined));

    // Distinct addresses so viem cannot collapse these into one deduplicated
    // call: what is under test is batching, not request deduplication.
    await Promise.all(
      Array.from({ length: 10 }, (_unused, index) =>
        client.getCode(`0x${String(index).repeat(40)}` as `0x${string}`),
      ),
    );
    await client.disconnect();

    expect(httpRequests.count).toBe(10);
  });
});
