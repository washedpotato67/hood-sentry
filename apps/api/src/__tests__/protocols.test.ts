import type {
  LaunchpadGraduation,
  LaunchpadMigration,
  LaunchpadTokenCreated,
  NormalizedLiquidityEvent,
  NormalizedPool,
  NormalizedSwap,
} from '@hood-sentry/chain';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ProtocolReadRepository, protocolRoutes } from '../routes/protocols.js';

const TOKEN0 = '0x3000000000000000000000000000000000000001' as const;
const TOKEN1 = '0x3000000000000000000000000000000000000002' as const;
const POOL = '0x2000000000000000000000000000000000000001' as const;
const FACTORY = '0x1000000000000000000000000000000000000001' as const;
const HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;

const pool: NormalizedPool = {
  chainId: 4663,
  protocolKey: 'fixture-dex',
  protocolVersion: 'v1',
  poolAddress: POOL,
  factoryAddress: FACTORY,
  token0Address: TOKEN0,
  token1Address: TOKEN1,
  feeTier: 3_000n,
  poolType: 'constantProduct',
  createdBlockNumber: 100n,
  createdBlockHash: HASH,
  creationTransactionHash: HASH,
  creationLogIndex: 1,
  canonical: true,
};

class ReadRepository implements ProtocolReadRepository {
  async listProtocols(_chainId: number, kind?: 'dex' | 'launchpad') {
    return [
      {
        chainId: 4663,
        protocolKey: kind === 'launchpad' ? 'fixture-launchpad' : 'fixture-dex',
        protocolName: kind === 'launchpad' ? 'Fixture Launchpad' : 'Fixture DEX',
        protocolVersion: 'v1',
        kind: kind ?? 'dex',
        enabled: kind !== 'launchpad',
        validationStatus: kind === 'launchpad' ? ('disabled' as const) : ('active' as const),
        validatedAt: new Date('2026-07-14T12:00:00.000Z'),
        validationExpiresAt: new Date('2026-07-14T12:05:00.000Z'),
      },
    ];
  }

  async listProtocolVerifications() {
    return [
      {
        chainId: 4663,
        protocolKey: 'fixture-dex',
        protocolVersion: 'v1',
        contractRole: 'factory',
        address: FACTORY,
        expectedRuntimeBytecodeHash: HASH,
        observedRuntimeBytecodeHash: HASH,
        valid: true,
        failureCode: null,
        errors: [],
        checkedAt: new Date('2026-07-14T12:00:00.000Z'),
        expiresAt: new Date('2026-07-14T12:05:00.000Z'),
      },
    ];
  }

  async getPoolsByToken(): Promise<readonly NormalizedPool[]> {
    return [pool];
  }

  async getSwapsByPool(): Promise<readonly NormalizedSwap[]> {
    return [];
  }

  async getLiquidityHistory(): Promise<readonly NormalizedLiquidityEvent[]> {
    return [];
  }

  async getLaunchpadToken(): Promise<LaunchpadTokenCreated | null> {
    return null;
  }

  async getGraduation(): Promise<LaunchpadGraduation | null> {
    return null;
  }

  async getMigration(): Promise<LaunchpadMigration | null> {
    return null;
  }
}

describe('protocol read routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    app = Fastify();
    await app.register(protocolRoutes, { prefix: '/v1', repository: new ReadRepository() });
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns supported DEX protocols without internal registry notes', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/protocols?chainId=4663' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: [{ protocolKey: 'fixture-dex', validationStatus: 'active' }],
    });
    expect(response.body).not.toContain('notes');
  });

  it('returns disabled launchpads explicitly', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/launchpads?chainId=4663' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: [{ protocolKey: 'fixture-launchpad', enabled: false }],
    });
  });

  it('serializes integer pool values as decimal strings', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/pools/by-token/${TOKEN0}?chainId=4663`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: [{ poolAddress: POOL, feeTier: '3000', createdBlockNumber: '100' }],
    });
  });

  it('returns a clear unavailable result for unknown launchpad tokens', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/launchpads/tokens/${TOKEN0}/state?chainId=4663`,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: 'LAUNCHPAD_TOKEN_NOT_FOUND' } });
  });
});
