import { evmAddressSchema } from '@hood-sentry/api-contracts';
import type { ProtocolRepository } from '@hood-sentry/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const chainQuerySchema = z.object({ chainId: z.coerce.number().int().positive() });
const tokenParamsSchema = z.object({ tokenAddress: evmAddressSchema });
const poolParamsSchema = z.object({ poolAddress: evmAddressSchema });

export type ProtocolReadRepository = Pick<
  ProtocolRepository,
  | 'listProtocols'
  | 'listProtocolVerifications'
  | 'getPoolsByToken'
  | 'getSwapsByPool'
  | 'getLiquidityHistory'
  | 'getLaunchpadToken'
  | 'getGraduation'
  | 'getMigration'
>;

export async function protocolRoutes(
  app: FastifyInstance,
  options: { repository: ProtocolReadRepository },
) {
  app.get('/protocols', async (request) => {
    const { chainId } = chainQuerySchema.parse(request.query);
    return { data: serialize(await options.repository.listProtocols(chainId, 'dex')) };
  });

  app.get('/launchpads', async (request) => {
    const { chainId } = chainQuerySchema.parse(request.query);
    return { data: serialize(await options.repository.listProtocols(chainId, 'launchpad')) };
  });

  app.get('/protocols/verification', async (request) => {
    const { chainId } = chainQuerySchema.parse(request.query);
    return { data: serialize(await options.repository.listProtocolVerifications(chainId)) };
  });

  app.get('/pools/by-token/:tokenAddress', async (request) => {
    const { chainId } = chainQuerySchema.parse(request.query);
    const { tokenAddress } = tokenParamsSchema.parse(request.params);
    return { data: serialize(await options.repository.getPoolsByToken(chainId, tokenAddress)) };
  });

  app.get('/pools/:poolAddress/swaps', async (request) => {
    const { chainId } = chainQuerySchema.parse(request.query);
    const { poolAddress } = poolParamsSchema.parse(request.params);
    return { data: serialize(await options.repository.getSwapsByPool(chainId, poolAddress)) };
  });

  app.get('/pools/:poolAddress/liquidity', async (request) => {
    const { chainId } = chainQuerySchema.parse(request.query);
    const { poolAddress } = poolParamsSchema.parse(request.params);
    return {
      data: serialize(await options.repository.getLiquidityHistory(chainId, poolAddress)),
    };
  });

  app.get('/launchpads/tokens/:tokenAddress/state', async (request, reply) => {
    const { chainId } = chainQuerySchema.parse(request.query);
    const { tokenAddress } = tokenParamsSchema.parse(request.params);
    const token = await options.repository.getLaunchpadToken(chainId, tokenAddress);
    if (token === null)
      return reply.code(404).send({ error: { code: 'LAUNCHPAD_TOKEN_NOT_FOUND' } });
    const [graduation, migration] = await Promise.all([
      options.repository.getGraduation(chainId, tokenAddress),
      options.repository.getMigration(chainId, tokenAddress),
    ]);
    return serialize({ token, graduation, migration });
  });

  app.get('/launchpads/tokens/:tokenAddress/graduation', async (request, reply) => {
    const { chainId } = chainQuerySchema.parse(request.query);
    const { tokenAddress } = tokenParamsSchema.parse(request.params);
    const graduation = await options.repository.getGraduation(chainId, tokenAddress);
    if (graduation === null) {
      return reply.code(404).send({ error: { code: 'GRADUATION_NOT_FOUND' } });
    }
    return serialize(graduation);
  });

  app.get('/launchpads/tokens/:tokenAddress/migration', async (request, reply) => {
    const { chainId } = chainQuerySchema.parse(request.query);
    const { tokenAddress } = tokenParamsSchema.parse(request.params);
    const migration = await options.repository.getMigration(chainId, tokenAddress);
    if (migration === null) return reply.code(404).send({ error: { code: 'MIGRATION_NOT_FOUND' } });
    return serialize(migration);
  });
}

function serialize(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === 'bigint' ? item.toString() : item,
    ),
  ) as unknown;
}
