import { ForbiddenError } from '@hood-sentry/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getAddress, isAddress } from 'viem';
import { z } from 'zod';
import { type AuthSessionManager, requireTrustedOrigin } from '../auth-session.js';
import { type TradingService, serializeIntent, serializeQuote } from '../trading-service.js';

const addressSchema = z
  .string()
  .refine(isAddress, 'Invalid EVM address')
  .transform((address) => getAddress(address));
const rawAmountSchema = z
  .string()
  .regex(/^[0-9]+$/)
  .transform(BigInt);
const positiveRawAmountSchema = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .transform(BigInt);

const quoteSchema = z.object({
  chainId: z.number().int().positive(),
  inputTokenAddress: addressSchema,
  outputTokenAddress: addressSchema,
  amountInRaw: positiveRawAmountSchema,
  slippageBps: rawAmountSchema.refine((value) => value >= 1n && value <= 2_000n),
  maximumPriceImpactBps: rawAmountSchema
    .refine((value) => value >= 1n && value <= 5_000n)
    .default('1000'),
  protocolKey: z.string().trim().min(1).max(64).optional(),
});
const prepareSchema = z.object({ quoteId: z.string().trim().min(1).max(128) });
const approvalSchema = z.object({
  chainId: z.number().int().positive(),
  tokenAddress: addressSchema,
  spenderAddress: addressSchema,
  amountRaw: positiveRawAmountSchema,
});
const revokeSchema = z.object({
  chainId: z.number().int().positive(),
  tokenAddress: addressSchema,
  spenderAddress: addressSchema,
});
const intentParamsSchema = z.object({ intentId: z.string().trim().min(1).max(128) });
const transactionHashSchema = z.object({
  transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

export type TradingRouteOptions = {
  sessions: AuthSessionManager;
  service: TradingService;
  publicAppUrl: string;
  chainId: number;
};

async function sessionWallet(request: FastifyRequest, options: TradingRouteOptions) {
  requireTrustedOrigin(request, options.publicAppUrl);
  const session = await options.sessions.require(request);
  const wallet = session.wallets.find(
    (entry) => entry.chainId === options.chainId && entry.isPrimary,
  );
  if (wallet === undefined) throw new ForbiddenError('A verified primary chain wallet is required');
  return { session, wallet };
}

export async function tradingRoutes(app: FastifyInstance, options: TradingRouteOptions) {
  app.get('/trading/status', async () => ({ data: options.service.status() }));

  app.post('/quotes', async (request) => {
    const input = quoteSchema.parse(request.body);
    return { data: serializeQuote(await options.service.quote(input)) };
  });

  app.post('/trades/prepare', async (request) => {
    const input = prepareSchema.parse(request.body);
    const { session, wallet } = await sessionWallet(request, options);
    return {
      data: serializeIntent(
        await options.service.prepareSwap({
          quoteId: input.quoteId,
          userId: session.user.id,
          walletAddress: wallet.address,
        }),
      ),
    };
  });

  app.post('/approvals/prepare', async (request) => {
    const input = approvalSchema.parse(request.body);
    const { session, wallet } = await sessionWallet(request, options);
    return {
      data: serializeIntent(
        await options.service.prepareApproval({
          ...input,
          userId: session.user.id,
          walletAddress: wallet.address,
        }),
      ),
    };
  });

  app.post('/approvals/revoke-prepare', async (request) => {
    const input = revokeSchema.parse(request.body);
    const { session, wallet } = await sessionWallet(request, options);
    return {
      data: serializeIntent(
        await options.service.prepareApproval({
          ...input,
          userId: session.user.id,
          walletAddress: wallet.address,
          amountRaw: 0n,
        }),
      ),
    };
  });

  app.post('/transaction-intents/:intentId/broadcast', async (request) => {
    const { intentId } = intentParamsSchema.parse(request.params);
    const input = transactionHashSchema.parse(request.body);
    const { session, wallet } = await sessionWallet(request, options);
    return {
      data: await options.service.recordBroadcast({
        intentId,
        transactionHash: input.transactionHash,
        userId: session.user.id,
        walletAddress: wallet.address,
      }),
    };
  });

  app.post('/transaction-intents/:intentId/confirm', async (request) => {
    const { intentId } = intentParamsSchema.parse(request.params);
    const input = transactionHashSchema.parse(request.body);
    const { session, wallet } = await sessionWallet(request, options);
    return {
      data: await options.service.recordConfirmation({
        intentId,
        transactionHash: input.transactionHash,
        userId: session.user.id,
        walletAddress: wallet.address,
      }),
    };
  });
}
