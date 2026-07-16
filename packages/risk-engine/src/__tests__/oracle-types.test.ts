import { describe, expect, it } from 'vitest';
import {
  type OracleBehaviorResult,
  deserializeOracleResult,
  serializeOracleResult,
} from '../oracle-types.js';

const base: OracleBehaviorResult = {
  applicable: true,
  sourceKey: 'chainlink-eth-usd',
  answerRaw: 150_000_000n,
  decimals: 8,
  roundId: 110n,
  answeredInRound: 110n,
  updatedAtSeconds: 1_752_000_000n,
  scanTimeSeconds: 1_752_000_030n,
  heartbeatSeconds: 3600,
  oraclePaused: false,
  sequencerConfigured: true,
  sequencerUp: true,
  sequencerRecoveredAtSeconds: null,
  sourceBlock: 200n,
};

describe('oracle result serialization', () => {
  it('round-trips through serialize/deserialize preserving bigints', () => {
    const restored = deserializeOracleResult(serializeOracleResult(base));
    expect(restored).toEqual(base);
  });

  it('rejects malformed serialized input', () => {
    expect(() => deserializeOracleResult({ applicable: 'yes' })).toThrow();
  });
});
