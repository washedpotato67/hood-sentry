import {
  candleQuerySchema,
  evmAddressSchema,
  metricsQuerySchema,
  priceHistoryQuerySchema,
  priceQuerySchema,
} from '@hood-sentry/api-contracts';
import type { PricingRepository } from '@hood-sentry/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const tokenParamsSchema = z.object({ tokenAddress: evmAddressSchema });

export type PricingReadRepository = Pick<
  PricingRepository,
  'getCurrentPrice' | 'getPriceHistory' | 'getCandles' | 'getLatestMetrics'
>;

export async function pricingRoutes(
  app: FastifyInstance,
  options: { repository: PricingReadRepository },
) {
  app.get('/tokens/:tokenAddress/price', async (request) => {
    const { tokenAddress } = tokenParamsSchema.parse(request.params);
    const query = priceQuerySchema.parse(request.query);
    const value = await options.repository.getCurrentPrice(
      query.chainId,
      tokenAddress,
      query.quoteAssetAddress,
    );
    if (value === null) {
      return {
        data: {
          tokenAddress,
          quoteAssetAddress: query.quoteAssetAddress,
          priceRaw: null,
          priceDecimals: null,
          status: 'unavailable',
          source: 'unavailable',
          sourceContractAddress: null,
          sourceBlockNumber: null,
          sourceBlockHash: null,
          sourceTimestamp: null,
          observedAt: null,
          freshnessSeconds: null,
          stale: false,
          confidenceBps: '0',
          warnings: ['NO_PRICE_OBSERVATION'],
          methodologyVersion: null,
        },
      };
    }
    return {
      data: serialize({
        tokenAddress: value.tokenAddress,
        quoteAssetAddress: value.quoteAssetAddress,
        priceRaw: value.priceRaw,
        priceDecimals: value.priceDecimals,
        status: value.status,
        source: value.sourceKey,
        sourceContractAddress: value.sourceContractAddress,
        sourceBlockNumber: value.sourceBlockNumber,
        sourceBlockHash: value.sourceBlockHash,
        sourceTimestamp: value.sourceTimestamp,
        observedAt: value.observedAt,
        freshnessSeconds: freshnessSeconds(value.sourceTimestamp, value.observedAt),
        stale: value.stale,
        confidenceBps: value.confidenceBps,
        warnings: value.reasons,
        methodologyVersion: value.methodologyVersion,
      }),
    };
  });

  app.get('/tokens/:tokenAddress/price/history', async (request) => {
    const { tokenAddress } = tokenParamsSchema.parse(request.params);
    const query = priceHistoryQuerySchema.parse(request.query);
    const values = await options.repository.getPriceHistory(
      query.chainId,
      tokenAddress,
      query.quoteAssetAddress,
      new Date(query.from),
      new Date(query.to),
    );
    return { data: serialize(values) };
  });

  app.get('/tokens/:tokenAddress/candles', async (request) => {
    const { tokenAddress } = tokenParamsSchema.parse(request.params);
    const query = candleQuerySchema.parse(request.query);
    const values = await options.repository.getCandles(
      query.chainId,
      tokenAddress,
      query.quoteAssetAddress,
      query.window,
      query.limit,
    );
    return { data: serialize(values) };
  });

  app.get('/tokens/:tokenAddress/metrics', async (request) => {
    const { tokenAddress } = tokenParamsSchema.parse(request.params);
    const query = metricsQuerySchema.parse(request.query);
    const value = await options.repository.getLatestMetrics(
      query.chainId,
      tokenAddress,
      query.quoteAssetAddress,
      query.window,
    );
    return { data: serialize(value) };
  });
}

function freshnessSeconds(sourceTimestamp: string, observedAt: string): bigint {
  const sourceMilliseconds = Date.parse(sourceTimestamp);
  const observedMilliseconds = Date.parse(observedAt);
  if (!Number.isFinite(sourceMilliseconds) || !Number.isFinite(observedMilliseconds)) {
    throw new Error('Stored price timestamp is invalid');
  }
  const difference = Math.max(0, observedMilliseconds - sourceMilliseconds);
  return BigInt(Math.floor(difference / 1_000));
}

function serialize(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === 'bigint' ? item.toString() : item,
    ),
  );
}
