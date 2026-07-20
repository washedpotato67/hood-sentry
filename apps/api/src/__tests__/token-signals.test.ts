import type { ProtocolRepository, RiskRepository } from '@hood-sentry/db';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { tokenSignalRoutes } from '../routes/token-signals.js';

const TOKEN = '0x1111111111111111111111111111111111111111';

async function buildServer(counts: {
  high: number;
  medium: number;
  low: number;
  unavailable: number;
}) {
  const app = Fastify();
  await app.register(tokenSignalRoutes, {
    risk: {
      getFindingSeverityCounts: async () => [{ targetAddress: TOKEN, ...counts }],
    } as unknown as RiskRepository,
    protocol: {
      getTokenLiquiditySeries: async () => [],
    } as unknown as ProtocolRepository,
  });
  return app;
}

async function signalsFor(counts: {
  high: number;
  medium: number;
  low: number;
  unavailable: number;
}) {
  const app = await buildServer(counts);
  const response = await app.inject({
    method: 'GET',
    url: `/discovery/signals?chainId=4663&addresses=${TOKEN}`,
  });
  await app.close();
  return response.json().data[TOKEN].signals;
}

describe('discovery signals', () => {
  it('reports rules that could not run separately from findings', async () => {
    // The analyzer records a zero-confidence finding when a rule cannot run.
    // Folding those into the low count would report an unscannable contract as a
    // risky one, which is the opposite of what the number is meant to convey.
    const signals = await signalsFor({ high: 0, medium: 0, low: 0, unavailable: 62 });

    expect(signals.low).toBe(0);
    expect(signals.unavailable).toBe(62);
  });

  it('keeps assessed severities distinct from unchecked rules', async () => {
    const signals = await signalsFor({ high: 1, medium: 2, low: 3, unavailable: 40 });

    expect(signals).toEqual({ high: 1, medium: 2, low: 3, unavailable: 40 });
  });
});
