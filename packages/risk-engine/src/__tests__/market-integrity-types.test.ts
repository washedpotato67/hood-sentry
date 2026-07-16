import { describe, expect, it } from 'vitest';
import {
  type MarketIntegrityResult,
  deserializeMarketIntegrityResult,
  serializeMarketIntegrityResult,
} from '../market-integrity-types.js';

const base: MarketIntegrityResult = {
  priceReliability: {
    available: true,
    activeSourceCount: 2,
    disagreementSourceKeys: ['dex-usdg'],
    outlierReasons: ['DEPEG'],
    oneTransactionManipulation: false,
  },
  tradeManipulation: {
    available: true,
    tradeCount: 42,
    minTradesForAssessment: 20,
    observedSignalCodes: ['SELF_TRADING'],
    insufficientSignalCodes: ['THIN_POOL_PRICE_MANIPULATION'],
    methodologyVersion: 'manipulation-v1',
  },
  sourceBlock: 200n,
};

describe('market integrity result serialization', () => {
  it('round-trips preserving structure and bigints', () => {
    expect(deserializeMarketIntegrityResult(serializeMarketIntegrityResult(base))).toEqual(base);
  });

  it('rejects malformed input', () => {
    expect(() => deserializeMarketIntegrityResult({ priceReliability: 5 })).toThrow();
  });
});
