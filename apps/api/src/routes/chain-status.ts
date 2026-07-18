import type { BlockRepository } from '@hood-sentry/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const querySchema = z.object({
  chainId: z.coerce
    .number()
    .int()
    .refine((v) => v === 4663 || v === 46630, 'unsupported chainId'),
});

/**
 * Public, unauthenticated live status for the header readout: chain head,
 * finalized height, the indexer's latest stored block, and the resulting lag.
 * Lag is how far behind the head the indexer is — an honest number on the free
 * RPC tier, not a flaw to hide.
 */
export async function chainStatusRoutes(
  app: FastifyInstance,
  options: { repository: BlockRepository },
) {
  app.get('/chain-status', async (request) => {
    const { chainId } = querySchema.parse(request.query);
    const status = await options.repository.getChainStatus(BigInt(chainId));
    if (status === null) {
      return {
        data: {
          chainId,
          headBlock: null,
          finalizedBlock: null,
          latestIndexedBlock: null,
          lagBlocks: null,
        },
      };
    }
    const lagBlocks =
      status.headBlock !== null && status.latestIndexedBlock !== null
        ? status.headBlock - status.latestIndexedBlock > 0n
          ? status.headBlock - status.latestIndexedBlock
          : 0n
        : null;
    return {
      data: {
        chainId,
        headBlock: status.headBlock?.toString() ?? null,
        finalizedBlock: status.finalizedBlock?.toString() ?? null,
        latestIndexedBlock: status.latestIndexedBlock?.toString() ?? null,
        lagBlocks: lagBlocks?.toString() ?? null,
      },
    };
  });
}
