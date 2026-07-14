import { describe, expect, it } from 'vitest';
import { analyzeHolders, concentrationChange } from '../holder-analysis.js';
import type { HolderAnalysisInput } from '../holder-types.js';

const base = (balances: HolderAnalysisInput['balances']): HolderAnalysisInput => ({
  chainId: 1,
  tokenAddress: '0x1111111111111111111111111111111111111111',
  sourceBlock: 10n,
  sourceBlockHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  totalSupplyRaw: 1000n,
  balances,
  methodologyVersion: 'holders-v1',
});
describe('holder analysis', () => {
  it('keeps raw and adjusted values and visible exclusions', () => {
    const result = analyzeHolders({
      ...base([
        { address: '0x0000000000000000000000000000000000000000', balanceRaw: 100n },
        { address: '0x2222222222222222222222222222222222222222', balanceRaw: 900n },
      ]),
      classifications: [
        {
          address: '0x0000000000000000000000000000000000000000',
          addressClass: 'zero_burn',
          verified: true,
          reason: 'burn address',
          provenance: 'chain',
        },
      ],
    });
    expect(result.rawConcentrationBps.top1).toBe(9000n);
    expect(result.adjustedConcentrationBps.top1).toBe(10000n);
    expect(result.circulatingSupplyRaw).toBe(900n);
    expect(result.exclusions).toHaveLength(1);
  });
  it('does not exclude unknown contracts and handles rebase uncertainty', () => {
    const result = analyzeHolders({
      ...base([{ address: '0x3333333333333333333333333333333333333333', balanceRaw: 1000n }]),
      rebaseState: 'uncertain',
    });
    expect(result.circulatingSupplyRaw).toBeNull();
    expect(result.warnings).toContain('Rebase state is uncertain');
  });
  it('emits deterministic concentration changes', () => {
    const a = analyzeHolders(
      base([
        { address: '0x2222222222222222222222222222222222222222', balanceRaw: 400n },
        { address: '0x3333333333333333333333333333333333333333', balanceRaw: 300n },
        { address: '0x4444444444444444444444444444444444444444', balanceRaw: 300n },
      ]),
    );
    const b = analyzeHolders({
      ...base([
        { address: '0x2222222222222222222222222222222222222222', balanceRaw: 800n },
        { address: '0x3333333333333333333333333333333333333333', balanceRaw: 100n },
        { address: '0x4444444444444444444444444444444444444444', balanceRaw: 100n },
      ]),
      sourceBlock: 11n,
    });
    expect(concentrationChange(a, b, 1000n)?.changeBps).toBe(4000n);
  });
});
