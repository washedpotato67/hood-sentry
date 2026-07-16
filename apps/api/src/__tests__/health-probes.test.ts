import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createBlockscoutHealthProbe,
  createRpcHealthProbe,
  createRpcProviderProbe,
} from '../health-probes.js';

const requestSchema = z.object({ method: z.enum(['eth_chainId', 'eth_blockNumber']) });

function rpcFetch(responses: {
  chainId?: string;
  blockNumber?: string;
  malformed?: boolean;
}): typeof fetch {
  return async (_input, init) => {
    if (responses.malformed === true) return Response.json({ unexpected: true });
    if (typeof init?.body !== 'string') throw new Error('Missing RPC request body');
    const request = requestSchema.parse(JSON.parse(init.body));
    return Response.json({
      jsonrpc: '2.0',
      id: 1,
      result:
        request.method === 'eth_chainId'
          ? (responses.chainId ?? '0x1237')
          : (responses.blockNumber ?? '0x64'),
    });
  };
}

describe('RPC health probe', () => {
  it('reports a healthy matching provider and indexed head', async () => {
    const probe = createRpcHealthProbe({
      rpcUrl: 'https://rpc.example.test',
      expectedChainId: 4663,
      readIndexedHead: async () => 95n,
      timeoutMs: 100,
      maximumBlockLag: 10n,
      fetchRequest: rpcFetch({}),
    });

    await expect(probe()).resolves.toMatchObject({
      status: 'ok',
      details: {
        chainId: 4663,
        providerBlock: '100',
        indexedBlock: '95',
        blockLag: '5',
      },
    });
  });

  it('rejects a provider on the wrong chain', async () => {
    const probe = createRpcHealthProbe({
      rpcUrl: 'https://rpc.example.test',
      expectedChainId: 4663,
      readIndexedHead: async () => 95n,
      timeoutMs: 100,
      maximumBlockLag: 10n,
      fetchRequest: rpcFetch({ chainId: '0x1' }),
    });

    await expect(probe()).resolves.toMatchObject({
      status: 'error',
      code: 'RPC_CHAIN_ID_MISMATCH',
      details: { expectedChainId: 4663, observedChainId: 1 },
    });
  });

  it('reports excessive indexer block lag', async () => {
    const probe = createRpcHealthProbe({
      rpcUrl: 'https://rpc.example.test',
      expectedChainId: 4663,
      readIndexedHead: async () => 80n,
      timeoutMs: 100,
      maximumBlockLag: 10n,
      fetchRequest: rpcFetch({}),
    });

    await expect(probe()).resolves.toMatchObject({
      status: 'error',
      code: 'INDEXER_BLOCK_LAG',
      details: { blockLag: '20' },
    });
  });

  it('reports missing indexer state separately from provider failure', async () => {
    const missing = createRpcHealthProbe({
      rpcUrl: 'https://rpc.example.test',
      expectedChainId: 4663,
      readIndexedHead: async () => null,
      timeoutMs: 100,
      maximumBlockLag: 10n,
      fetchRequest: rpcFetch({}),
    });
    const unavailable = createRpcHealthProbe({
      rpcUrl: 'https://rpc.example.test',
      expectedChainId: 4663,
      readIndexedHead: async () => {
        throw new Error('database unavailable');
      },
      timeoutMs: 100,
      maximumBlockLag: 10n,
      fetchRequest: rpcFetch({}),
    });

    await expect(missing()).resolves.toMatchObject({
      status: 'error',
      code: 'INDEXER_NOT_INITIALIZED',
    });
    await expect(unavailable()).resolves.toMatchObject({
      status: 'error',
      code: 'INDEXER_STATE_UNAVAILABLE',
    });
  });

  it('rejects malformed provider responses without exposing response details', async () => {
    const probe = createRpcHealthProbe({
      rpcUrl: 'https://rpc.example.test',
      expectedChainId: 4663,
      readIndexedHead: async () => 95n,
      timeoutMs: 100,
      maximumBlockLag: 10n,
      fetchRequest: rpcFetch({ malformed: true }),
    });

    await expect(probe()).resolves.toMatchObject({
      status: 'error',
      code: 'RPC_UNAVAILABLE',
    });
  });
});

describe('provider health probes', () => {
  it('checks the RPC provider without depending on indexed state', async () => {
    const probe = createRpcProviderProbe({
      rpcUrl: 'https://rpc.example.test',
      expectedChainId: 4663,
      timeoutMs: 100,
      fetchRequest: rpcFetch({}),
    });

    await expect(probe()).resolves.toMatchObject({
      status: 'ok',
      details: { chainId: 4663, providerBlock: '100' },
    });
  });

  it('authenticates Blockscout health requests without returning the key', async () => {
    let requestedUrl = '';
    const probe = createBlockscoutHealthProbe({
      apiBaseUrl: 'https://explorer.example/api',
      apiKey: 'health-secret',
      timeoutMs: 100,
      fetchRequest: async (input) => {
        requestedUrl = String(input);
        return Response.json({ total_blocks: '10' });
      },
    });

    const result = await probe();

    expect(requestedUrl).toContain('apikey=health-secret');
    expect(result).toMatchObject({ status: 'ok', details: { authenticated: true } });
    expect(JSON.stringify(result)).not.toContain('health-secret');
  });
});
