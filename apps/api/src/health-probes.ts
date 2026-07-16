import type { OracleClient } from '@hood-sentry/chain';
import {
  type Database,
  DrizzlePricingRepository,
  type PricingRepository,
  checkHealth,
} from '@hood-sentry/db';
import { ProviderHttpClient } from '@hood-sentry/providers';
import { createQueueConnection } from '@hood-sentry/queue';
import { z } from 'zod';

export type DependencyName = 'database' | 'redis' | 'rpc';
export type DependencyStatus = 'ok' | 'error';

export interface DependencyCheck {
  status: DependencyStatus;
  latencyMs: number;
  code?: string;
  details?: Readonly<Record<string, string | number | boolean | null>>;
}

export type DependencyProbe = () => Promise<DependencyCheck>;

export interface HealthProbes {
  database: DependencyProbe;
  redis: DependencyProbe;
  rpc: DependencyProbe;
  providers?: readonly ProviderProbeDefinition[];
}

export interface ProviderProbeDefinition {
  providerId: string;
  capability: string;
  required: boolean;
  configured: boolean;
  probe?: DependencyProbe;
}

interface RpcProbeOptions {
  rpcUrl: string;
  expectedChainId: number;
  readIndexedHead: () => Promise<bigint | null>;
  timeoutMs: number;
  maximumBlockLag: bigint;
  fetchRequest?: typeof fetch;
}

const rpcResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.number().int(),
  result: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

const indexedHeadSchema = z.object({
  number: z.union([z.string(), z.number(), z.bigint()]).nullable(),
});
const blockscoutStatsSchema = z.record(z.unknown());

async function readIndexedHead(database: Database, chainId: number): Promise<bigint | null> {
  const rows = await database.client`
    SELECT MAX(number)::text AS number
    FROM blocks
    WHERE chain_id = ${chainId} AND canonical = true
  `;
  const indexedHead = indexedHeadSchema.parse(rows[0]);
  return indexedHead.number === null ? null : BigInt(indexedHead.number);
}

function failed(startedAt: number, code: string): DependencyCheck {
  return { status: 'error', latencyMs: Date.now() - startedAt, code };
}

async function rpcCall(
  rpcUrl: string,
  method: 'eth_chainId' | 'eth_blockNumber',
  timeoutMs: number,
  fetchRequest: typeof fetch,
): Promise<string> {
  const response = await fetchRequest(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error('RPC request failed');
  return rpcResponseSchema.parse(await response.json()).result;
}

export function createDatabaseHealthProbe(database: Database): DependencyProbe {
  return async () => {
    const result = await checkHealth(database);
    return result.healthy
      ? { status: 'ok', latencyMs: result.latencyMs }
      : { status: 'error', latencyMs: result.latencyMs, code: 'DATABASE_UNAVAILABLE' };
  };
}

export function createRedisHealthProbe(redisUrl: string): DependencyProbe {
  return async () => {
    const startedAt = Date.now();
    const connection = createQueueConnection(redisUrl, {
      lazyConnect: true,
      connectTimeout: 1_000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    connection.on('error', () => undefined);

    try {
      await connection.connect();
      const response = await connection.ping();
      if (response !== 'PONG') return failed(startedAt, 'REDIS_INVALID_RESPONSE');
      return { status: 'ok', latencyMs: Date.now() - startedAt };
    } catch {
      return failed(startedAt, 'REDIS_UNAVAILABLE');
    } finally {
      connection.disconnect();
    }
  };
}

export function createRpcHealthProbe(options: RpcProbeOptions): DependencyProbe {
  const fetchRequest = options.fetchRequest ?? fetch;

  return async () => {
    const startedAt = Date.now();
    try {
      const observedChainId = Number(
        BigInt(await rpcCall(options.rpcUrl, 'eth_chainId', options.timeoutMs, fetchRequest)),
      );
      if (observedChainId !== options.expectedChainId) {
        return {
          ...failed(startedAt, 'RPC_CHAIN_ID_MISMATCH'),
          details: { expectedChainId: options.expectedChainId, observedChainId },
        };
      }

      const providerBlock = BigInt(
        await rpcCall(options.rpcUrl, 'eth_blockNumber', options.timeoutMs, fetchRequest),
      );
      let indexedBlock: bigint | null;
      try {
        indexedBlock = await options.readIndexedHead();
      } catch {
        return failed(startedAt, 'INDEXER_STATE_UNAVAILABLE');
      }
      if (indexedBlock === null) {
        return {
          ...failed(startedAt, 'INDEXER_NOT_INITIALIZED'),
          details: { providerBlock: providerBlock.toString(), indexedBlock: null },
        };
      }

      if (indexedBlock > providerBlock) {
        return {
          ...failed(startedAt, 'INDEXER_AHEAD_OF_PROVIDER'),
          details: {
            providerBlock: providerBlock.toString(),
            indexedBlock: indexedBlock.toString(),
          },
        };
      }

      const blockLag = providerBlock - indexedBlock;
      const details = {
        chainId: observedChainId,
        providerBlock: providerBlock.toString(),
        indexedBlock: indexedBlock.toString(),
        blockLag: blockLag.toString(),
      };
      if (blockLag > options.maximumBlockLag) {
        return { ...failed(startedAt, 'INDEXER_BLOCK_LAG'), details };
      }

      return { status: 'ok', latencyMs: Date.now() - startedAt, details };
    } catch {
      return failed(startedAt, 'RPC_UNAVAILABLE');
    }
  };
}

export function createRpcProviderProbe(options: {
  rpcUrl: string;
  expectedChainId: number;
  timeoutMs: number;
  fetchRequest?: typeof fetch;
}): DependencyProbe {
  const fetchRequest = options.fetchRequest ?? fetch;
  return async () => {
    const startedAt = Date.now();
    try {
      const observedChainId = Number(
        BigInt(await rpcCall(options.rpcUrl, 'eth_chainId', options.timeoutMs, fetchRequest)),
      );
      if (observedChainId !== options.expectedChainId) {
        return {
          ...failed(startedAt, 'RPC_CHAIN_ID_MISMATCH'),
          details: { expectedChainId: options.expectedChainId, observedChainId },
        };
      }
      const providerBlock = BigInt(
        await rpcCall(options.rpcUrl, 'eth_blockNumber', options.timeoutMs, fetchRequest),
      );
      return {
        status: 'ok',
        latencyMs: Date.now() - startedAt,
        details: { chainId: observedChainId, providerBlock: providerBlock.toString() },
      };
    } catch {
      return failed(startedAt, 'RPC_UNAVAILABLE');
    }
  };
}

export function createBlockscoutHealthProbe(options: {
  apiBaseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  fetchRequest?: typeof fetch;
}): DependencyProbe {
  const apiRoot = new URL(options.apiBaseUrl);
  apiRoot.pathname = apiRoot.pathname.replace(/\/$/, '').replace(/\/api$/, '');
  apiRoot.search = '';
  apiRoot.hash = '';
  const statsUrl = new URL('/api/v2/stats', apiRoot);
  if (options.apiKey !== undefined) statsUrl.searchParams.set('apikey', options.apiKey);
  const client = new ProviderHttpClient({
    providerId: 'blockscout',
    fetchRequest: options.fetchRequest,
    timeoutMs: options.timeoutMs,
    maximumAttempts: 1,
    requestsPerSecond: 3,
  });

  return async () => {
    const startedAt = Date.now();
    try {
      await client.request({
        url: statsUrl.toString(),
        schema: blockscoutStatsSchema,
        secretValues: options.apiKey === undefined ? [] : [options.apiKey],
      });
      return {
        status: 'ok',
        latencyMs: Date.now() - startedAt,
        details: { authenticated: options.apiKey !== undefined },
      };
    } catch {
      return failed(startedAt, 'BLOCKSCOUT_UNAVAILABLE');
    }
  };
}

export function createOracleHealthProbe(options: {
  repository: PricingRepository;
  oracleClient: OracleClient;
  chainId: number;
  gracePeriodSeconds?: number;
}): DependencyProbe {
  return async () => {
    const startedAt = Date.now();
    try {
      const configs = await options.repository.listSourceConfigs(options.chainId);
      const enabledChainlink = configs
        .filter(
          (
            config,
          ): config is typeof config & {
            oracleHeartbeatSeconds: number;
            sourceContractAddress: NonNullable<typeof config.sourceContractAddress>;
          } =>
            config.enabled &&
            config.sourceType === 'chainlink' &&
            config.sourceContractAddress !== null &&
            config.oracleHeartbeatSeconds !== undefined,
        )
        .sort((left, right) => left.priority - right.priority);

      const source = enabledChainlink[0];
      if (source === undefined) {
        return {
          status: 'ok',
          latencyMs: Date.now() - startedAt,
          code: 'ORACLE_NOT_CONFIGURED',
        };
      }

      const heartbeatSeconds = source.oracleHeartbeatSeconds;
      const price = await options.oracleClient.readPriceFeed(source.sourceContractAddress);
      if (price.answer <= 0n) {
        return {
          ...failed(startedAt, 'ORACLE_ANSWER_INVALID'),
          details: { sourceKey: source.sourceKey, answer: price.answer.toString() },
        };
      }

      const updatedAtSeconds = Math.floor(Date.parse(price.updatedAt) / 1000);
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (nowSeconds - updatedAtSeconds > heartbeatSeconds) {
        return {
          ...failed(startedAt, 'ORACLE_STALE'),
          details: {
            sourceKey: source.sourceKey,
            heartbeatSeconds,
            updatedAt: price.updatedAt,
          },
        };
      }

      if (source.sequencerFeedAddress !== undefined && source.sequencerFeedAddress !== null) {
        const sequencer = await options.oracleClient.readSequencerFeed(source.sequencerFeedAddress);
        if (!sequencer.up) {
          return {
            ...failed(startedAt, 'SEQUENCER_DOWN'),
            details: { sourceKey: source.sourceKey, sequencerFeed: source.sequencerFeedAddress },
          };
        }
        const grace = options.gracePeriodSeconds ?? heartbeatSeconds;
        if (
          sequencer.recoveredAt !== undefined &&
          nowSeconds - Number(sequencer.recoveredAt) < grace
        ) {
          return {
            ...failed(startedAt, 'SEQUENCER_GRACE_PERIOD'),
            details: {
              sourceKey: source.sourceKey,
              recoveredAt: new Date(Number(sequencer.recoveredAt) * 1000).toISOString(),
              gracePeriodSeconds: grace,
            },
          };
        }
      }

      return {
        status: 'ok',
        latencyMs: Date.now() - startedAt,
        details: { sourceKey: source.sourceKey, answer: price.answer.toString() },
      };
    } catch {
      return failed(startedAt, 'ORACLE_UNAVAILABLE');
    }
  };
}

export function createHealthProbes(input: {
  database: Database;
  redisUrl: string;
  rpcUrl: string;
  chainId: number;
  rpcTimeoutMs: number;
  rpcProviderId?: string;
  blockscoutApiBaseUrl?: string;
  blockscoutApiKey?: string;
  oracleClient?: OracleClient;
  optionalProviderConfiguration?: readonly {
    providerId: string;
    capability: string;
    configured: boolean;
    probe?: DependencyProbe;
  }[];
  maximumBlockLag?: bigint;
}): HealthProbes {
  const rpc = createRpcHealthProbe({
    rpcUrl: input.rpcUrl,
    expectedChainId: input.chainId,
    readIndexedHead: () => readIndexedHead(input.database, input.chainId),
    timeoutMs: input.rpcTimeoutMs,
    maximumBlockLag: input.maximumBlockLag ?? 100n,
  });
  const providers: ProviderProbeDefinition[] = [
    {
      providerId: input.rpcProviderId ?? 'primary-rpc',
      capability: 'rpc',
      required: true,
      configured: true,
      probe: createRpcProviderProbe({
        rpcUrl: input.rpcUrl,
        expectedChainId: input.chainId,
        timeoutMs: input.rpcTimeoutMs,
      }),
    },
  ];
  if (input.blockscoutApiBaseUrl !== undefined) {
    providers.push({
      providerId: 'blockscout',
      capability: 'explorer',
      required: false,
      configured: true,
      probe: createBlockscoutHealthProbe({
        apiBaseUrl: input.blockscoutApiBaseUrl,
        apiKey: input.blockscoutApiKey,
        timeoutMs: input.rpcTimeoutMs,
      }),
    });
  }
  for (const provider of input.optionalProviderConfiguration ?? []) {
    providers.push({ ...provider, required: false });
  }
  if (input.oracleClient !== undefined) {
    providers.push({
      providerId: 'chainlink-oracle',
      capability: 'oracle',
      required: false,
      configured: true,
      probe: createOracleHealthProbe({
        repository: new DrizzlePricingRepository(input.database.db),
        oracleClient: input.oracleClient,
        chainId: input.chainId,
      }),
    });
  }
  return {
    database: createDatabaseHealthProbe(input.database),
    redis: createRedisHealthProbe(input.redisUrl),
    rpc,
    providers,
  };
}
