import { describe, expect, it } from 'vitest';
import { buildMarketIntegrityResult } from '../jobs/market-integrity-context.js';

describe('buildMarketIntegrityResult', () => {
  it('marks disagreement and self-trading from engine outputs', () => {
    const result = buildMarketIntegrityResult({
      sourceBlock: 200n,
      priceAvailable: true,
      activeSourceCount: 2,
      disagreementWarnings: ['SOURCE_DISAGREEMENT:dex-usdg:250'],
      outlierReasons: [],
      primaryReasons: [],
      tradesAvailable: true,
      tradeCount: 40,
      manipulation: {
        methodologyVersion: 'manipulation-v1',
        signals: [{ code: 'SELF_TRADING', status: 'observed' }],
      },
    });
    expect(result.priceReliability.disagreementSourceKeys).toEqual(['dex-usdg']);
    expect(result.tradeManipulation.observedSignalCodes).toEqual(['SELF_TRADING']);
  });

  it('marks price unavailable when there is no observation', () => {
    const result = buildMarketIntegrityResult({
      sourceBlock: 200n,
      priceAvailable: false,
      activeSourceCount: 0,
      disagreementWarnings: [],
      outlierReasons: [],
      primaryReasons: [],
      tradesAvailable: true,
      tradeCount: 0,
      manipulation: { methodologyVersion: 'manipulation-v1', signals: [] },
    });
    expect(result.priceReliability.available).toBe(false);
  });

  it('flags single-transaction price manipulation from the primary observation reasons', () => {
    const result = buildMarketIntegrityResult({
      sourceBlock: 200n,
      priceAvailable: true,
      activeSourceCount: 1,
      disagreementWarnings: [],
      outlierReasons: ['ONE_TRANSACTION_MANIPULATION'],
      primaryReasons: ['ONE_TRANSACTION_MANIPULATION'],
      tradesAvailable: true,
      tradeCount: 3,
      manipulation: { methodologyVersion: 'manipulation-v1', signals: [] },
    });
    expect(result.priceReliability.oneTransactionManipulation).toBe(true);
    expect(result.priceReliability.outlierReasons).toEqual(['ONE_TRANSACTION_MANIPULATION']);
  });

  it('marks trade manipulation unavailable only when trades could not be read', () => {
    const result = buildMarketIntegrityResult({
      sourceBlock: 200n,
      priceAvailable: true,
      activeSourceCount: 1,
      disagreementWarnings: [],
      outlierReasons: [],
      primaryReasons: [],
      tradesAvailable: false,
      tradeCount: 0,
      manipulation: { methodologyVersion: 'manipulation-v1', signals: [] },
    });
    expect(result.tradeManipulation.available).toBe(false);
    expect(result.tradeManipulation.minTradesForAssessment).toBe(20);
  });

  it('filters observed signals down to the known market-integrity codes', () => {
    const result = buildMarketIntegrityResult({
      sourceBlock: 200n,
      priceAvailable: true,
      activeSourceCount: 1,
      disagreementWarnings: [],
      outlierReasons: [],
      primaryReasons: [],
      tradesAvailable: true,
      tradeCount: 25,
      manipulation: {
        methodologyVersion: 'manipulation-v1',
        signals: [
          { code: 'SELF_TRADING', status: 'notObserved' },
          { code: 'REPEATED_WALLET_PAIR', status: 'observed' },
          { code: 'NOT_A_REAL_CODE', status: 'observed' },
        ],
      },
    });
    expect(result.tradeManipulation.observedSignalCodes).toEqual(['REPEATED_WALLET_PAIR']);
  });

  it('carries signals the analyzer could not assess as insufficient, not passing', () => {
    const result = buildMarketIntegrityResult({
      sourceBlock: 200n,
      priceAvailable: false,
      activeSourceCount: 0,
      disagreementWarnings: [],
      outlierReasons: [],
      primaryReasons: [],
      tradesAvailable: true,
      tradeCount: 30,
      manipulation: {
        methodologyVersion: 'manipulation-v1',
        signals: [
          { code: 'THIN_POOL_PRICE_MANIPULATION', status: 'insufficientData' },
          { code: 'SELF_TRADING', status: 'notObserved' },
        ],
      },
    });
    expect(result.tradeManipulation.insufficientSignalCodes).toEqual([
      'THIN_POOL_PRICE_MANIPULATION',
    ]);
    expect(result.tradeManipulation.observedSignalCodes).toEqual([]);
  });
});
