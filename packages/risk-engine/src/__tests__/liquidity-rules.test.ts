import { describe, expect, it } from 'vitest';
import { analyzeLiquidityRisk } from '../liquidity-risk.js';
import type { LiquidityRiskInput } from '../liquidity-risk.js';
import { LIQUIDITY_STATE_SOURCE, createLiquidityRiskRules } from '../liquidity-rules.js';
import type { RiskRule, RiskScanContext } from '../types.js';

const POOL = '0x1111111111111111111111111111111111111111' as const;
const CREATOR = '0x2222222222222222222222222222222222222222' as const;
const LOCKER = '0x3333333333333333333333333333333333333333' as const;
const BLOCK_HASH = `0x${'ab'.repeat(32)}` as const;

function input(overrides: Partial<LiquidityRiskInput> = {}): LiquidityRiskInput {
  return {
    chainId: 4663,
    poolAddress: POOL,
    protocolKey: 'verified-dex',
    poolType: 'v2',
    quoteAsset: '0x4444444444444444444444444444444444444444',
    verifiedProtocol: true,
    sourceBlock: 100n,
    sourceBlockHash: BLOCK_HASH,
    poolAgeBlocks: 1_000n,
    tokenLiquidityRaw: 1_000n,
    quoteLiquidityRaw: 1_000n,
    currentLiquidityRaw: 1_000n,
    priceImpactBps: 10n,
    providers: [
      { address: LOCKER, liquidityRaw: 600n },
      { address: CREATOR, liquidityRaw: 400n },
    ],
    ownership: { kind: 'locked', lockContract: LOCKER, verified: true },
    removalsRaw: 0n,
    additionsRaw: 1_000n,
    ...overrides,
  };
}

function context(overrides: Partial<LiquidityRiskInput> = {}): RiskScanContext {
  return {
    target: { type: 'pool', chainId: 4663, address: POOL },
    sourceBlock: 100n,
    sourceBlockHash: BLOCK_HASH,
    methodologyVersion: '1.0.0',
    data: { liquidityAnalysis: analyzeLiquidityRisk(input(overrides)) },
    dataSources: [],
  };
}

function rule(id: string): RiskRule {
  const found = createLiquidityRiskRules().find((candidate) => candidate.ruleId === id);
  if (found === undefined) throw new Error(`No rule ${id}`);
  return found;
}

async function evaluate(id: string, overrides: Partial<LiquidityRiskInput> = {}) {
  return rule(id).evaluate(context(overrides), new AbortController().signal);
}

describe('liquidity rules', () => {
  it('passes a verified, locked, well-provided pool', async () => {
    for (const candidate of createLiquidityRiskRules()) {
      const result = await candidate.evaluate(context(), new AbortController().signal);
      expect(result.status, `${candidate.ruleId} should pass`).toBe('pass');
      expect(result.remediation).toBeNull();
    }
  });

  it('fails when the creator holds the LP position', async () => {
    const result = await evaluate('liquidity.removable_creator_liquidity', {
      ownership: { kind: 'creator', owner: CREATOR, verified: true },
    });
    expect(result.status).toBe('fail');
    expect(result.severity).toBe('high');
    expect(result.remediation).not.toBeNull();
  });

  it('reports an unverifiable lock as unknown rather than a failure', async () => {
    const result = await evaluate('liquidity.liquidity_not_verifiably_locked', {
      ownership: { kind: 'unknown', verified: false },
    });
    // Absence of evidence is not evidence of missing locks.
    expect(result.status).toBe('unknown');
    // A withheld conclusion carries no confidence.
    expect(result.confidence.level).toBe('unknown');
    expect(result.confidence.basisPoints).toBe(0);
  });

  it('does not let an unverifiable lock deduct from the score', () => {
    expect(rule('liquidity.liquidity_not_verifiably_locked').maxPenaltyBps).toBe(0);
    expect(rule('liquidity.removable_creator_liquidity').maxPenaltyBps).toBeGreaterThan(0);
  });

  it('fails when removals exceed half of current liquidity', async () => {
    const result = await evaluate('liquidity.abrupt_liquidity_removal', {
      currentLiquidityRaw: 1_000n,
      removalsRaw: 501n,
    });
    expect(result.status).toBe('fail');
  });

  it('warns on a single liquidity provider', async () => {
    const result = await evaluate('liquidity.single_pool_dependency', {
      providers: [{ address: LOCKER, liquidityRaw: 1_000n }],
    });
    expect(result.status).toBe('warning');
  });

  it('warns when one provider dominates the pool', async () => {
    const result = await evaluate('liquidity.provider_concentration', {
      providers: [
        { address: LOCKER, liquidityRaw: 9_500n },
        { address: CREATOR, liquidityRaw: 500n },
      ],
    });
    expect(result.status).toBe('warning');
    expect(result.evidence[0]?.data.providerConcentrationBps).toBe('9500');
  });

  it('holds concentration at the threshold boundary', async () => {
    const atThreshold = await evaluate('liquidity.provider_concentration', {
      providers: [
        { address: LOCKER, liquidityRaw: 9_000n },
        { address: CREATOR, liquidityRaw: 1_000n },
      ],
    });
    expect(atThreshold.status).toBe('warning');

    const belowThreshold = await evaluate('liquidity.provider_concentration', {
      providers: [
        { address: LOCKER, liquidityRaw: 8_999n },
        { address: CREATOR, liquidityRaw: 1_001n },
      ],
    });
    expect(belowThreshold.status).toBe('pass');
  });

  it('lowers confidence when the protocol is unverified', async () => {
    const result = await evaluate('liquidity.unknown_protocol', { verifiedProtocol: false });
    expect(result.status).toBe('warning');
    expect(result.confidence.level).toBe('low');
  });

  it('fails when liquidity migrated to an unexpected venue', async () => {
    const result = await evaluate('liquidity.unexpected_migration_venue', {
      migrationDestination: CREATOR,
      expectedMigrationDestination: LOCKER,
    });
    expect(result.status).toBe('fail');
  });

  it('carries provenance and evidence on every finding', async () => {
    for (const candidate of createLiquidityRiskRules()) {
      const result = await candidate.evaluate(context(), new AbortController().signal);
      expect(candidate.requiredDataSources).toContain(LIQUIDITY_STATE_SOURCE);
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.evidence[0]?.provenanceKeys).toContain(LIQUIDITY_STATE_SOURCE);
    }
  });

  it('is deterministic across repeated evaluations', async () => {
    const first = await evaluate('liquidity.removable_creator_liquidity', {
      ownership: { kind: 'creator', owner: CREATOR, verified: true },
    });
    const second = await evaluate('liquidity.removable_creator_liquidity', {
      ownership: { kind: 'creator', owner: CREATOR, verified: true },
    });
    expect(first).toEqual(second);
  });

  it('rejects malformed analysis data instead of guessing', async () => {
    const malformed: RiskScanContext = {
      ...context(),
      data: { liquidityAnalysis: { nope: true } },
    };
    await expect(
      rule('liquidity.single_pool_dependency').evaluate(malformed, new AbortController().signal),
    ).rejects.toThrow(/malformed/i);
  });

  it('registers one rule per code with a unique id', () => {
    const rules = createLiquidityRiskRules();
    const ids = new Set(rules.map((candidate) => candidate.ruleId));
    expect(ids.size).toBe(rules.length);
    for (const candidate of rules) expect(candidate.category).toBe('Liquidity');
  });
});
