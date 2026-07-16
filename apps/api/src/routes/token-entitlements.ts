import { ForbiddenError } from '@hood-sentry/shared';
import type { FastifyInstance } from 'fastify';
import { type AuthSessionManager, requireTrustedOrigin } from '../auth-session.js';
import type { TokenEntitlementService } from '../token-entitlement-service.js';

export type TokenEntitlementRouteOptions = {
  sessions: AuthSessionManager;
  service: TokenEntitlementService;
  publicAppUrl: string;
  chainId: number;
};

export async function tokenEntitlementRoutes(
  app: FastifyInstance,
  options: TokenEntitlementRouteOptions,
) {
  app.get('/token-entitlements/status', async (request) => {
    const session = await options.sessions.require(request);
    return {
      data: await options.service.status(
        session.wallets
          .filter((wallet) => wallet.chainId === options.chainId)
          .map((wallet) => wallet.address),
      ),
    };
  });

  app.post('/token-entitlements/reconcile', async (request) => {
    requireTrustedOrigin(request, options.publicAppUrl);
    const session = await options.sessions.require(request);
    const wallet = session.wallets.find(
      (entry) => entry.chainId === options.chainId && entry.isPrimary,
    );
    if (wallet === undefined) throw new ForbiddenError('A verified chain wallet is required');
    return { data: await options.service.reconcile(wallet.address) };
  });
}
