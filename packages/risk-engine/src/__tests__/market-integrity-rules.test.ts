import { describe, expect, it } from 'vitest';
import type { RiskScanContext } from '../index.js';
import { createMarketIntegrityRiskRules } from '../market-integrity-rules.js';
import {
  MARKET_PRICE_RELIABILITY_SOURCE,
  MARKET_TRADE_MANIPULATION_SOURCE,
  type MarketIntegrityResult,
  serializeMarketIntegrityResult,
} from '../market-integrity-types.js';

const RESULT: MarketIntegrityResult = {
  priceReliability: {
    available: true,
    activeSourceCount: 2,
    disagreementSourceKeys: [],
    outlierReasons: [],
    oneTransactionManipulation: false,
  },
  tradeManipulation: {
    available: true,
    tradeCount: 42,
    minTradesForAssessment: 20,
    observedSignalCodes: [],
    insufficientSignalCodes: [],
    methodologyVersion: 'manipulation-v1',
  },
  sourceBlock: 200n,
};

function context(overrides: Partial<MarketIntegrityResult> = {}): RiskScanContext {
  const merged = { ...RESULT, ...overrides };
  const serialized = serializeMarketIntegrityResult(merged);
  return {
    target: { type: 'token', chainId: 4663, address: '0x3000000000000000000000000000000000000001' },
    sourceBlock: 200n,
    sourceBlockHash: `0x${'a'.repeat(64)}`,
    methodologyVersion: '1.0.0',
    data: {
      [MARKET_PRICE_RELIABILITY_SOURCE]: serialized,
      [MARKET_TRADE_MANIPULATION_SOURCE]: serialized,
    },
    dataSources: [],
  };
}

const abort = new AbortController().signal;
const rule = (id: string) =>
  createMarketIntegrityRiskRules().find((r) => r.ruleId === id) ??
  (() => {
    throw new Error(`missing ${id}`);
  })();

describe('market integrity rules', () => {
  it('warns when sources disagree', async () => {
    const e = await rule('market.source_price_disagreement').evaluate(
      context({
        priceReliability: { ...RESULT.priceReliability, disagreementSourceKeys: ['dex'] },
      }),
      abort,
    );
    expect(e.status).toBe('warning');
  });

  it('marks disagreement not_applicable with a single source', async () => {
    const e = await rule('market.source_price_disagreement').evaluate(
      context({ priceReliability: { ...RESULT.priceReliability, activeSourceCount: 1 } }),
      abort,
    );
    expect(e.status).toBe('not_applicable');
  });

  it('fails on one-transaction price manipulation', async () => {
    const e = await rule('market.single_transaction_price_manipulation').evaluate(
      context({
        priceReliability: { ...RESULT.priceReliability, oneTransactionManipulation: true },
      }),
      abort,
    );
    expect(e.status).toBe('fail');
  });

  it('fails on observed self-trading', async () => {
    const e = await rule('market.self_trading').evaluate(
      context({
        tradeManipulation: { ...RESULT.tradeManipulation, observedSignalCodes: ['SELF_TRADING'] },
      }),
      abort,
    );
    expect(e.status).toBe('fail');
  });

  it('passes a clean, active market for a manipulation rule', async () => {
    const e = await rule('market.self_trading').evaluate(context(), abort);
    expect(e.status).toBe('pass');
  });

  it('marks manipulation rules not_applicable below the trade threshold', async () => {
    const e = await rule('market.self_trading').evaluate(
      context({ tradeManipulation: { ...RESULT.tradeManipulation, tradeCount: 5 } }),
      abort,
    );
    expect(e.status).toBe('not_applicable');
  });

  it('marks a manipulation rule unknown when its signal could not be assessed', async () => {
    const e = await rule('market.thin_pool_price_manipulation').evaluate(
      context({
        tradeManipulation: {
          ...RESULT.tradeManipulation,
          insufficientSignalCodes: ['THIN_POOL_PRICE_MANIPULATION'],
        },
      }),
      abort,
    );
    expect(e.status).toBe('unknown');
  });

  it('marks price rules unknown when price data is unavailable', async () => {
    const e = await rule('market.price_outlier').evaluate(
      context({ priceReliability: { ...RESULT.priceReliability, available: false } }),
      abort,
    );
    expect(e.status).toBe('unknown');
  });

  it('caps every rule penalty at the category cap', () => {
    for (const r of createMarketIntegrityRiskRules())
      expect(r.maxPenaltyBps).toBeLessThanOrEqual(3000);
  });
});
