import { resetEnvCache } from '@hood-sentry/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

const testEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/hood_sentry_test',
  DATABASE_POOL_MIN: '2',
  DATABASE_POOL_MAX: '5',
  REDIS_URL: 'redis://localhost:6379',
  QUEUE_PREFIX: 'hoodsentry_test',
  ROBINHOOD_CHAIN_ID: '46630',
  ROBINHOOD_RPC_PRIMARY: 'https://rpc.testnet.chain.robinhood.com',
  BLOCKSCOUT_API_BASE: 'https://robinhoodchain.blockscout.com/api',
  BLOCKSCOUT_WEB_BASE: 'https://robinhoodchain.blockscout.com',
  RPC_TIMEOUT_MS: '30000',
  RPC_MAX_RETRIES: '3',
  INDEXER_CONFIRMATION_MODE: 'soft',
  SIWE_DOMAIN: 'localhost:3000',
  SIWE_URI: 'http://localhost:3000',
  SESSION_SECRET: 'a'.repeat(64),
  SESSION_DURATION_SECONDS: '86400',
  SESSION_REAUTH_SECONDS: '3600',
  OTEL_SERVICE_NAME: 'hood-sentry-test',
};

let originalEnv: NodeJS.ProcessEnv;

beforeAll(() => {
  originalEnv = { ...process.env };
  resetEnvCache();
  Object.assign(process.env, testEnv);
});

afterAll(() => {
  resetEnvCache();
  process.env = originalEnv;
});

describe('API Health Endpoints', () => {
  it('GET /health/live returns ok', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/health/live',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    await app.close();
  });

  it('GET /health/ready returns ready when dependencies are ok', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ready');
    expect(body.checks).toBeDefined();
    await app.close();
  });

  it('GET /health/dependencies returns configured dependencies', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/health/dependencies',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.database).toBeDefined();
    expect(body.redis).toBeDefined();
    expect(body.rpc).toBeDefined();
    await app.close();
  });
});

describe('API Request ID Propagation', () => {
  it('generates request ID for each request', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/health/live',
    });

    expect(response.headers['x-request-id']).toBeDefined();
    await app.close();
  });

  it('generates unique request IDs', async () => {
    const app = await buildApp();
    const response1 = await app.inject({
      method: 'GET',
      url: '/health/live',
    });
    const response2 = await app.inject({
      method: 'GET',
      url: '/health/live',
    });

    const id1 = response1.headers['x-request-id'];
    const id2 = response2.headers['x-request-id'];
    expect(id1).not.toBe(id2);
    await app.close();
  });
});

describe('API Startup', () => {
  it('builds app successfully', async () => {
    const app = await buildApp();
    expect(app).toBeDefined();
    await app.close();
  });

  it('closes gracefully', async () => {
    const app = await buildApp();
    await expect(app.close()).resolves.toBeUndefined();
  });
});

describe('API Rate Limits', () => {
  it('throttles repeated public requests by client address', async () => {
    const app = await buildApp();
    let finalStatus = 0;
    for (let index = 0; index < 101; index += 1) {
      const response = await app.inject({ method: 'GET', url: '/health/live' });
      finalStatus = response.statusCode;
    }
    expect(finalStatus).toBe(429);
    await app.close();
  });
});

describe('API Safe Errors', () => {
  it('returns a generic 400 response for invalid request schemas', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/discovery/pricePump?chainId=4663',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request did not match the required schema.',
      },
    });
    expect(response.body).not.toContain('invalid_enum_value');
    await app.close();
  });
});
