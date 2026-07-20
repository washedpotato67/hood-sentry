import type { OracleClient } from '@hood-sentry/chain';
import type { PricingRepository } from '@hood-sentry/db';
import type { PriceSourceConfig } from '@hood-sentry/market-engine';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createBlockscoutHealthProbe,
  createOracleHealthProbe,
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

  it('treats an indexer sitting at its structural floor as healthy', async () => {
    // A healthy live indexer cannot sit near the head: it holds 64 blocks back
    // for finality, drains in 10-block windows, and polls once a second on a
    // chain producing ten blocks a second. A threshold near that floor would
    // report a fault the design guarantees, so readiness must allow for it.
    const structuralFloor = 64n + 10n + 10n;
    const probe = createRpcHealthProbe({
      rpcUrl: 'https://rpc.example.test',
      expectedChainId: 4663,
      readIndexedHead: async () => 100n - structuralFloor,
      timeoutMs: 100,
      maximumBlockLag: 250n,
      fetchRequest: rpcFetch({}),
    });

    await expect(probe()).resolves.toMatchObject({ status: 'ok' });
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

function chainlinkConfig(overrides: Partial<PriceSourceConfig> = {}): PriceSourceConfig {
  return {
    sourceKey: 'chainlink-fixture',
    sourceType: 'chainlink',
    assetClass: 'erc20',
    chainId: 4663,
    sourceContractAddress: '0x1000000000000000000000000000000000000001',
    sourceAssetAddress: '0x3000000000000000000000000000000000000001',
    quoteAssetAddress: '0x3000000000000000000000000000000000000002',
    verificationSourceUrl: 'https://docs.chain.link/',
    verifiedAt: '2026-07-14T00:00:00.000Z',
    minimumLiquidityRaw: 0n,
    liquidityDecimals: 0,
    maximumStalenessSeconds: 3600,
    enabled: true,
    priority: 1,
    confidenceRules: {
      baseConfidenceBps: 9_000n,
      thinLiquidityPenaltyBps: 0n,
      stalePenaltyBps: 0n,
      disagreementThresholdBps: 0n,
      disagreementPenaltyBps: 0n,
      maximumPriceImpactBps: 0n,
      maximumSingleTransactionVolumeBps: 0n,
      maximumPriceJumpBps: 0n,
      stablecoinDepegThresholdBps: 0n,
      minimumAuthoritativeConfidenceBps: 7_000n,
    },
    route: [],
    methodologyVersion: 'chainlink-v1',
    oracleHeartbeatSeconds: 60,
    ...overrides,
  };
}

function fakeOracleClient(state: {
  answer?: bigint;
  updatedAt?: string;
  sequencerUp?: boolean;
  recoveredAt?: bigint;
  throwPrice?: boolean;
  throwSequencer?: boolean;
}): OracleClient {
  return {
    readPriceFeed: async () => {
      if (state.throwPrice === true) throw new Error('price feed unavailable');
      return {
        answer: state.answer ?? 123_456_789n,
        decimals: 8,
        roundId: 100n,
        answeredInRound: 100n,
        updatedAt: state.updatedAt ?? new Date().toISOString(),
      };
    },
    readSequencerFeed: async () => {
      if (state.throwSequencer === true) throw new Error('sequencer feed unavailable');
      return {
        up: state.sequencerUp ?? true,
        recoveredAt: state.recoveredAt,
      };
    },
  } as unknown as OracleClient;
}

function fakePricingRepository(configs: readonly PriceSourceConfig[]): PricingRepository {
  return {
    listSourceConfigs: async () => configs,
  } as unknown as PricingRepository;
}

describe('oracle health probe', () => {
  it('reports healthy when the highest-priority feed is fresh and the sequencer is up', async () => {
    const probe = createOracleHealthProbe({
      repository: fakePricingRepository([chainlinkConfig()]),
      oracleClient: fakeOracleClient({}),
      chainId: 4663,
    });

    const result = await probe();

    expect(result.status).toBe('ok');
    expect(result.code).toBeUndefined();
    expect(result.details).toMatchObject({ sourceKey: 'chainlink-fixture', answer: '123456789' });
  });

  it('reports not configured when no Chainlink sources are enabled', async () => {
    const probe = createOracleHealthProbe({
      repository: fakePricingRepository([]),
      oracleClient: fakeOracleClient({}),
      chainId: 4663,
    });

    const result = await probe();

    expect(result).toMatchObject({ status: 'ok', code: 'ORACLE_NOT_CONFIGURED' });
  });

  it('fails when the feed answer is zero or negative', async () => {
    const probe = createOracleHealthProbe({
      repository: fakePricingRepository([chainlinkConfig()]),
      oracleClient: fakeOracleClient({ answer: 0n }),
      chainId: 4663,
    });

    const result = await probe();

    expect(result).toMatchObject({
      status: 'error',
      code: 'ORACLE_ANSWER_INVALID',
      details: { sourceKey: 'chainlink-fixture', answer: '0' },
    });
  });

  it('fails when the feed update is older than the heartbeat', async () => {
    const probe = createOracleHealthProbe({
      repository: fakePricingRepository([chainlinkConfig()]),
      oracleClient: fakeOracleClient({ updatedAt: '2026-07-14T12:00:00.000Z' }),
      chainId: 4663,
    });

    const result = await probe();

    expect(result).toMatchObject({
      status: 'error',
      code: 'ORACLE_STALE',
      details: { sourceKey: 'chainlink-fixture', heartbeatSeconds: 60 },
    });
  });

  it('fails when the sequencer is down', async () => {
    const probe = createOracleHealthProbe({
      repository: fakePricingRepository([
        chainlinkConfig({ sequencerFeedAddress: '0x2000000000000000000000000000000000000002' }),
      ]),
      oracleClient: fakeOracleClient({ sequencerUp: false }),
      chainId: 4663,
    });

    const result = await probe();

    expect(result).toMatchObject({
      status: 'error',
      code: 'SEQUENCER_DOWN',
      details: { sourceKey: 'chainlink-fixture' },
    });
  });

  it('fails during the sequencer grace period after recovery', async () => {
    const recentRecovery = BigInt(Math.floor(Date.now() / 1000) - 10);
    const probe = createOracleHealthProbe({
      repository: fakePricingRepository([
        chainlinkConfig({ sequencerFeedAddress: '0x2000000000000000000000000000000000000002' }),
      ]),
      oracleClient: fakeOracleClient({ recoveredAt: recentRecovery }),
      chainId: 4663,
    });

    const result = await probe();

    expect(result).toMatchObject({
      status: 'error',
      code: 'SEQUENCER_GRACE_PERIOD',
      details: { sourceKey: 'chainlink-fixture' },
    });
  });

  it('fails when the feed is unreachable', async () => {
    const probe = createOracleHealthProbe({
      repository: fakePricingRepository([chainlinkConfig()]),
      oracleClient: fakeOracleClient({ throwPrice: true }),
      chainId: 4663,
    });

    const result = await probe();

    expect(result).toMatchObject({
      status: 'error',
      code: 'ORACLE_UNAVAILABLE',
    });
  });
});
