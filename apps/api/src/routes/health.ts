import type { FastifyInstance } from 'fastify';
import type {
  DependencyCheck,
  DependencyName,
  DependencyProbe,
  HealthProbes,
  ProviderProbeDefinition,
} from '../health-probes.js';

async function runProbe(name: DependencyName, probe: DependencyProbe): Promise<DependencyCheck> {
  const startedAt = Date.now();
  try {
    return await probe();
  } catch {
    return {
      status: 'error',
      latencyMs: Date.now() - startedAt,
      code: `${name.toUpperCase()}_PROBE_FAILED`,
    };
  }
}

async function checkDependencies(probes: HealthProbes) {
  const [database, redis, rpc] = await Promise.all([
    runProbe('database', probes.database),
    runProbe('redis', probes.redis),
    runProbe('rpc', probes.rpc),
  ]);
  return { database, redis, rpc };
}

type ProviderHealthCheck = Omit<DependencyCheck, 'status'> & {
  status: 'healthy' | 'degraded' | 'disabled';
  capability: string;
  required: boolean;
  configured: boolean;
};

async function runProviderProbe(definition: ProviderProbeDefinition): Promise<ProviderHealthCheck> {
  if (!definition.configured) {
    return {
      status: 'disabled' as const,
      capability: definition.capability,
      required: definition.required,
      configured: false,
      latencyMs: 0,
    };
  }
  if (definition.probe === undefined) {
    return {
      status: 'degraded',
      capability: definition.capability,
      required: definition.required,
      configured: true,
      latencyMs: 0,
      code: 'PROVIDER_ADAPTER_UNAVAILABLE',
    };
  }
  let result: DependencyCheck;
  try {
    result = await definition.probe();
  } catch {
    result = { status: 'error', latencyMs: 0, code: 'PROVIDER_PROBE_FAILED' };
  }
  return {
    ...result,
    status: result.status === 'ok' ? ('healthy' as const) : ('degraded' as const),
    capability: definition.capability,
    required: definition.required,
    configured: true,
  };
}

async function checkProviders(probes: HealthProbes): Promise<Record<string, ProviderHealthCheck>> {
  const entries = await Promise.all(
    (probes.providers ?? []).map(
      async (definition) => [definition.providerId, await runProviderProbe(definition)] as const,
    ),
  );
  return Object.fromEntries(entries);
}

export async function healthRoutes(app: FastifyInstance, options: { probes: HealthProbes }) {
  app.get('/live', async () => {
    return { status: 'ok' };
  });

  app.get('/ready', async (_request, reply) => {
    const checks = await checkDependencies(options.probes);
    const allOk = Object.values(checks).every((c) => c.status === 'ok');

    return reply.status(allOk ? 200 : 503).send({
      status: allOk ? 'ready' : 'degraded',
      checks,
    });
  });

  app.get('/dependencies', async () => {
    const checks = await checkDependencies(options.probes);
    const allOk = Object.values(checks).every((check) => check.status === 'ok');
    return {
      status: allOk ? 'ready' : 'degraded',
      checks,
    };
  });

  app.get('/providers', async () => {
    const providers = await checkProviders(options.probes);
    const values = Object.values(providers);
    const requiredFailure = values.some(
      (provider) => provider.required && provider.status !== 'healthy',
    );
    const degraded = values.some((provider) => provider.status === 'degraded');
    return {
      status: requiredFailure ? 'unavailable' : degraded ? 'degraded' : 'healthy',
      providers,
    };
  });
}
