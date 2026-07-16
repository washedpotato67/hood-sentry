import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthSessionManager } from '../auth-session.js';
import { requireTrustedOrigin } from '../auth-session.js';
import type { RiskCommentaryService } from '../risk-commentary-service.js';

const chainIdSchema = z.union([z.literal(4663), z.literal(46630)]);
const paramsSchema = z.object({ address: z.string().regex(/^0x[a-fA-F0-9]{40}$/) });
const querySchema = z.object({ chainId: z.coerce.number().pipe(chainIdSchema).optional() });

export type RiskCommentaryRouteOptions = {
  sessions: AuthSessionManager;
  service: RiskCommentaryService;
  publicAppUrl: string;
  defaultChainId: 4663 | 46630;
};

export async function riskCommentaryRoutes(
  app: FastifyInstance,
  options: RiskCommentaryRouteOptions,
) {
  app.get('/risk-commentary/status', async () => ({ data: options.service.status() }));

  app.post(
    '/tokens/:address/risk-commentary',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      requireTrustedOrigin(request, options.publicAppUrl);
      await options.sessions.require(request);
      const params = paramsSchema.parse(request.params);
      const query = querySchema.parse(request.query);
      return {
        data: await options.service.get(
          query.chainId ?? options.defaultChainId,
          params.address.toLowerCase(),
        ),
      };
    },
  );
}
