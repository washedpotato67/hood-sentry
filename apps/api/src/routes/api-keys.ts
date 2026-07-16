import { API_KEY_SCOPES } from '@hood-sentry/auth';
import { NotFoundError, UnauthorizedError } from '@hood-sentry/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ApiKeyService } from '../api-key-service.js';
import { type AuthSessionManager, requireTrustedOrigin } from '../auth-session.js';

const idParamsSchema = z.object({ id: z.string().uuid() });
const inputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).max(API_KEY_SCOPES.length),
});

export type ApiKeyRouteOptions = {
  sessions: AuthSessionManager;
  service: ApiKeyService;
  publicAppUrl: string;
};

function token(request: FastifyRequest): string | null {
  const header = request.headers['x-api-key'];
  if (typeof header === 'string') return header;
  const authorization = request.headers.authorization;
  return authorization?.startsWith('Bearer hs_') ? authorization.slice(7) : null;
}

export async function apiKeyRoutes(app: FastifyInstance, options: ApiKeyRouteOptions) {
  app.get('/api-keys', async (request) => {
    requireTrustedOrigin(request, options.publicAppUrl);
    const session = await options.sessions.require(request);
    return { data: await options.service.list(session.user.id) };
  });

  app.post('/api-keys', async (request, reply) => {
    requireTrustedOrigin(request, options.publicAppUrl);
    const session = await options.sessions.require(request);
    const input = inputSchema.parse(request.body);
    const created = await options.service.issue({
      userId: session.user.id,
      name: input.name,
      scopes: input.scopes,
      quotaPerMinute: 60,
      quotaPerDay: 5_000,
    });
    return reply.status(201).send({ data: created });
  });

  app.delete('/api-keys/:id', async (request, reply) => {
    requireTrustedOrigin(request, options.publicAppUrl);
    const session = await options.sessions.require(request);
    const { id } = idParamsSchema.parse(request.params);
    if (!(await options.service.revoke(session.user.id, id))) {
      throw new NotFoundError('API key', id);
    }
    return reply.status(204).send();
  });

  app.get('/api-access/status', async (request) => {
    const value = token(request);
    if (value === null) throw new UnauthorizedError('An API key is required');
    return { data: await options.service.authenticate(value, null) };
  });
}
