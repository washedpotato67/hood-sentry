import { describe, expect, it } from 'vitest';
import { type LiveRiskInput, computeLiveRiskFindings } from '../live-risk.js';

// A token that trips nothing: deep liquidity, many pools, well distributed,
// verified non-proxy contract.
const clean: LiveRiskInput = {
  liquidityUsd: '250000',
  volume24hUsd: '80000',
  poolCount: 4,
  totalSupplyRaw: '1000000',
  topHolders: [
    { address: '0x1', balanceRaw: '50000' },
    { address: '0x2', balanceRaw: '40000' },
  ],
  contract: { verified: true, isProxy: false },
};

const ids = (input: LiveRiskInput) => computeLiveRiskFindings(input).map((f) => f.id);

describe('computeLiveRiskFindings', () => {
  it('reports an all-clear info finding when nothing trips', () => {
    const findings = computeLiveRiskFindings(clean);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toBe('no-elevated-signals');
    expect(findings[0]?.severity).toBe('info');
  });

  it('flags high concentration when one wallet holds a majority', () => {
    const findings = computeLiveRiskFindings({
      ...clean,
      topHolders: [{ address: '0x1', balanceRaw: '600000' }],
    });
    const concentration = findings.find((f) => f.id === 'holder-concentration');
    expect(concentration?.severity).toBe('high');
    expect(concentration?.explanation).toContain('60.0%');
  });

  it('flags very thin liquidity as high', () => {
    expect(ids({ ...clean, liquidityUsd: '4000' })).toContain('thin-liquidity');
    expect(
      computeLiveRiskFindings({ ...clean, liquidityUsd: '4000' }).find(
        (f) => f.id === 'thin-liquidity',
      )?.severity,
    ).toBe('high');
  });

  it('flags a single-pool market', () => {
    expect(ids({ ...clean, poolCount: 1 })).toContain('single-pool');
  });

  it('flags volume far exceeding liquidity', () => {
    expect(ids({ ...clean, liquidityUsd: '60000', volume24hUsd: '900000' })).toContain(
      'volume-liquidity-imbalance',
    );
  });

  it('flags unverified and proxy contracts', () => {
    const out = ids({ ...clean, contract: { verified: false, isProxy: true } });
    expect(out).toContain('unverified-contract');
    expect(out).toContain('proxy-contract');
  });

  it('skips concentration when total supply is unknown', () => {
    expect(ids({ ...clean, totalSupplyRaw: null })).not.toContain('holder-concentration');
  });
});
