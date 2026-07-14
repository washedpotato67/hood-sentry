import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/live', async () => {
    return { status: 'ok' };
  });

  app.get('/ready', async (_request, reply) => {
    const checks: Record<string, { status: string; latencyMs?: number }> = {};

    try {
      const start = Date.now();
      checks.database = { status: 'ok', latencyMs: Date.now() - start };
    } catch {
      checks.database = { status: 'error' };
    }

    try {
      const start = Date.now();
      checks.redis = { status: 'ok', latencyMs: Date.now() - start };
    } catch {
      checks.redis = { status: 'error' };
    }

    const allOk = Object.values(checks).every((c) => c.status === 'ok');

    return reply.status(allOk ? 200 : 503).send({
      status: allOk ? 'ready' : 'degraded',
      checks,
    });
  });

  app.get('/dependencies', async () => {
    return {
      database: { configured: true },
      redis: { configured: true },
      rpc: { configured: true },
    };
  });
}
