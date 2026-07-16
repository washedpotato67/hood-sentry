import { describe, expect, it } from 'vitest';
import { chainlinkEvidence } from '../observations.js';

const baseEvidence = {
  sourceBlockNumber: 100n,
  sourceBlockHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const,
  sourceTimestamp: '2026-07-14T12:00:00.000Z',
  observedAt: '2026-07-14T12:00:10.000Z',
  liquidityDepthRaw: null,
  liquidityDepthDecimals: null,
  priceImpactBps: null,
  singleTransactionVolumeBps: null,
  providerName: null,
  poolAddress: null,
  route: [],
  canonical: true,
};

function validInput(overrides?: Partial<Parameters<typeof chainlinkEvidence>[0]>) {
  return {
    answer: 1_000_000_000n,
    decimals: 8,
    roundId: 123n,
    answeredInRound: 123n,
    updatedAt: '2026-07-14T12:00:00.000Z',
    sequencerUp: true,
    sequencerGracePeriodElapsed: true,
    oraclePaused: false,
    ...overrides,
  };
}

describe('chainlinkEvidence', () => {
  it('returns price and empty reasons for a valid feed', () => {
    const evidence = chainlinkEvidence(validInput(), baseEvidence);
    expect(evidence.priceRaw).toBe(1_000_000_000n);
    expect(evidence.priceDecimals).toBe(8);
    expect(evidence.reasons).toEqual([]);
  });

  it('flags zero price as fatal', () => {
    const evidence = chainlinkEvidence(validInput({ answer: 0n }), baseEvidence);
    expect(evidence.priceRaw).toBeNull();
    expect(evidence.reasons).toContain('ZERO_PRICE');
  });

  it('flags negative price as fatal', () => {
    const evidence = chainlinkEvidence(validInput({ answer: -1n }), baseEvidence);
    expect(evidence.priceRaw).toBeNull();
    expect(evidence.reasons).toContain('NEGATIVE_PRICE');
  });

  it('flags missing source timestamp', () => {
    const evidence = chainlinkEvidence(
      validInput({ updatedAt: '1970-01-01T00:00:00.000Z' }),
      baseEvidence,
    );
    expect(evidence.reasons).toContain('MISSING_SOURCE_TIMESTAMP');
  });

  it('flags incomplete oracle round', () => {
    const evidence = chainlinkEvidence(validInput({ answeredInRound: 122n }), baseEvidence);
    expect(evidence.reasons).toContain('INCOMPLETE_ORACLE_ROUND');
  });

  it('flags sequencer down', () => {
    const evidence = chainlinkEvidence(validInput({ sequencerUp: false }), baseEvidence);
    expect(evidence.reasons).toContain('SEQUENCER_DOWN');
  });

  it('flags grace period', () => {
    const evidence = chainlinkEvidence(
      validInput({ sequencerGracePeriodElapsed: false }),
      baseEvidence,
    );
    expect(evidence.reasons).toContain('SEQUENCER_GRACE_PERIOD');
  });

  it('flags oracle paused', () => {
    const evidence = chainlinkEvidence(validInput({ oraclePaused: true }), baseEvidence);
    expect(evidence.priceRaw).toBeNull();
    expect(evidence.reasons).toContain('ORACLE_PAUSED');
  });
});
