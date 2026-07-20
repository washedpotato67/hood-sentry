import {
  candleQuerySchema,
  evmAddressSchema,
  metricsQuerySchema,
  priceHistoryQuerySchema,
  priceQuerySchema,
} from '@hood-sentry/api-contracts';
import type { PricingRepository } from '@hood-sentry/db';
import { type MarketDataSource, decimalToRaw } from '@hood-sentry/providers';
import type { RedisCache } from '@hood-sentry/queue';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

/** Reads the aggregator's USD price for a token, scaled to 18-decimal raw units. */
async function aggregatorPrice(
  options: { market?: MarketDataSource; readCache?: RedisCache },
  chainId: number,
  tokenAddress: `0x${string}`,
): Promise<{ priceRaw: string; priceDecimals: number; observedAt: string } | null> {
  if (options.market === undefined) return null;
  const compute = async () => {
    const market = await options.market?.tokenMarket(chainId, tokenAddress);
    if (market?.priceUsd == null) return null;
    try {
      return {
        priceRaw: decimalToRaw(market.priceUsd, 18),
        priceDecimals: 18,
        observedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  };
  if (options.readCache === undefined) return compute();
  return options.readCache.getOrCompute(
    `price:${chainId}:${tokenAddress.toLowerCase()}`,
    30,
    compute,
  );
}

const tokenParamsSchema = z.object({ tokenAddress: evmAddressSchema });

export type PricingReadRepository = Pick<
  PricingRepository,
  | 'getCurrentPrice'
  | 'getPriceHistory'
  | 'getCandles'
  | 'getLatestMetrics'
  | 'findLatestOracleStatus'
  | 'listSourceConfigs'
>;

export async function pricingRoutes(
  app: FastifyInstance,
  options: {
    repository: PricingReadRepository;
    market?: MarketDataSource;
    readCache?: RedisCache;
  },
) {
  app.get('/tokens/:tokenAddress/price', async (request) => {
    const { tokenAddress } = tokenParamsSchema.parse(request.params);
    const query = priceQuerySchema.parse(request.query);
    const value = await options.repository.getCurrentPrice(
      query.chainId,
      tokenAddress,
      query.quoteAssetAddress,
    );
    if (value === null && options.market !== undefined) {
      // No indexed observation: quote the aggregator's US-dollar price, which is
      // effectively the price in a dollar-pegged quote asset, attributed as
      // external data rather than a reserve reading this system observed.
      const aggregated = await aggregatorPrice(options, query.chainId, tokenAddress);
      if (aggregated !== null) {
        return {
          data: {
            tokenAddress,
            quoteAssetAddress: query.quoteAssetAddress,
            priceRaw: aggregated.priceRaw,
            priceDecimals: aggregated.priceDecimals,
            status: 'available',
            source: 'aggregator',
            sourceContractAddress: null,
            sourceBlockNumber: null,
            sourceBlockHash: null,
            sourceTimestamp: aggregated.observedAt,
            observedAt: aggregated.observedAt,
            freshnessSeconds: 0,
            stale: false,
            confidenceBps: '0',
            warnings: ['EXTERNAL_AGGREGATOR_PRICE'],
            methodologyVersion: 'aggregator-v1',
          },
        };
      }
    }
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

  app.get('/tokens/:tokenAddress/price/source-status', async (request) => {
    const { tokenAddress } = tokenParamsSchema.parse(request.params);
    const query = priceQuerySchema.parse(request.query);
    const [value, configs] = await Promise.all([
      options.repository.findLatestOracleStatus(
        query.chainId,
        tokenAddress,
        query.quoteAssetAddress,
      ),
      options.repository.listSourceConfigs(query.chainId, tokenAddress),
    ]);
    const config = configs.find((candidate) => candidate.sourceKey === value?.sourceKey);
    if (value === null) {
      return {
        data: {
          tokenAddress,
          quoteAssetAddress: query.quoteAssetAddress,
          sourceKey: null,
          sourceType: null,
          sourceContractAddress: null,
          answerRaw: null,
          decimals: null,
          updatedAt: null,
          heartbeatSeconds: null,
          sequencerUp: null,
          oraclePaused: null,
          roundId: null,
          answeredInRound: null,
          status: 'unavailable',
          reasons: ['NO_ORACLE_OBSERVATION'],
        },
      };
    }
    return {
      data: serialize({
        tokenAddress: value.tokenAddress,
        quoteAssetAddress: value.quoteAssetAddress,
        sourceKey: value.sourceKey,
        sourceType: value.sourceType,
        sourceContractAddress: value.sourceContractAddress,
        answerRaw: value.priceRaw,
        decimals: value.priceDecimals,
        updatedAt: value.sourceTimestamp,
        heartbeatSeconds: config?.oracleHeartbeatSeconds ?? null,
        sequencerUp: value.sequencerUp ?? null,
        oraclePaused: value.oraclePaused ?? false,
        roundId: value.roundId ?? null,
        answeredInRound: value.answeredInRound ?? null,
        status: value.status,
        reasons: value.reasons,
      }),
    };
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
