import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../plugins/error-handler.js';
import { intelligenceRoutes } from '../routes/intelligence.js';

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
} as unknown as Parameters<typeof errorHandler>[0];

async function buildServer() {
  const app = Fastify();
  app.setErrorHandler(errorHandler(silentLogger));
  await app.register(intelligenceRoutes, {
    defaultChainId: 4663,
    riskScoresEnabled: false,
    // Reached only for a well-formed address; a malformed one must be rejected
    // before any repository is consulted.
    tokens: { getToken: async () => null },
    contracts: { getContract: async () => null },
    protocols: { getPoolsByToken: async () => [] },
    risk: { getLatestScan: async () => null, getFindings: async () => [] },
  } as unknown as Parameters<typeof intelligenceRoutes>[1]);
  return app;
}

describe('token address validation', () => {
  it('rejects a malformed address as a client error, not a server fault', async () => {
    const app = await buildServer();

    const response = await app.inject({
      method: 'GET',
      url: '/tokens/not-an-address?chainId=4663',
    });
    await app.close();

    // A 500 here would blame the server for the caller's typo and bury genuine
    // internal failures in the same bucket.
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).not.toBe('INTERNAL_ERROR');
  });

  it('still reports a well-formed but unknown address as not found', async () => {
    const app = await buildServer();

    const response = await app.inject({
      method: 'GET',
      url: '/tokens/0x0000000000000000000000000000000000000001?chainId=4663',
    });
    await app.close();

    expect(response.statusCode).toBe(404);
  });
});
