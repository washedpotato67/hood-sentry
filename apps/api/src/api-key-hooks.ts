import type { ApiKeyScope } from '@hood-sentry/auth';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ApiKeyPrincipal, ApiKeyService } from './api-key-service.js';

const principals = new WeakMap<FastifyRequest, ApiKeyPrincipal>();

function requestToken(request: FastifyRequest): string | null {
  const explicit = request.headers['x-api-key'];
  if (typeof explicit === 'string') return explicit;
  const authorization = request.headers.authorization;
  return authorization?.startsWith('Bearer hs_') ? authorization.slice(7) : null;
}

function scopeFor(request: FastifyRequest): ApiKeyScope | null {
  const path = request.url.split('?')[0] ?? request.url;
  if (request.method === 'GET') {
    if (path.startsWith('/v1/wallets/')) return 'wallets:read';
    if (path.includes('/risk')) return 'risk:read';
    return 'tokens:read';
  }
  if (path.startsWith('/v1/alerts')) return 'alerts:write';
  if (path.startsWith('/v1/webhooks')) return 'webhooks:write';
  if (path.startsWith('/v1/projects')) return 'projects:write';
  return null;
}

function skipApiKeyHook(request: FastifyRequest): boolean {
  const path = request.url.split('?')[0] ?? request.url;
  return (
    path.startsWith('/v1/auth') ||
    path.startsWith('/v1/health') ||
    path.startsWith('/v1/api-keys') ||
    path === '/v1/api-access/status'
  );
}

export function installApiKeyHooks(app: FastifyInstance, service: ApiKeyService): void {
  app.addHook('onRequest', async (request) => {
    if (skipApiKeyHook(request)) return;
    const token = requestToken(request);
    if (token === null) return;
    const principal = await service.authenticate(token, scopeFor(request));
    principals.set(request, principal);
  });
  app.addHook('onSend', async (request, reply, payload) => {
    const principal = principals.get(request);
    if (principal !== undefined) {
      reply.header('x-api-key-prefix', principal.prefix);
      reply.header('x-ratelimit-remaining-minute', principal.minuteRemaining.toString());
      reply.header('x-ratelimit-remaining-day', principal.dayRemaining.toString());
    }
    return payload;
  });
}
