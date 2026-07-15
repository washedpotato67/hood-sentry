import { describe, expect, it } from 'vitest';
import { analyzeHolders } from '../holder-analysis.js';
import { HOLDER_BALANCES_SOURCE, createHolderDistributionRules } from '../holder-rules.js';
import type { HolderAnalysisInput, HolderBalance } from '../holder-types.js';
import type { RiskRule, RiskScanContext } from '../types.js';

const TOKEN = '0x1111111111111111111111111111111111111111' as const;
const BLOCK_HASH = `0x${'cd'.repeat(32)}` as const;

function address(index: number): `0x${string}` {
  return `0x${index.toString(16).padStart(40, '0')}` as `0x${string}`;
}

/** `count` holders with an equal balance, so concentration stays low by construction. */
function evenBalances(count: number, each = 100n): HolderBalance[] {
  return Array.from({ length: count }, (_, i) => ({ address: address(i + 1), balanceRaw: each }));
}

function input(overrides: Partial<HolderAnalysisInput> = {}): HolderAnalysisInput {
  return {
    chainId: 4663,
    tokenAddress: TOKEN,
    sourceBlock: 100n,
    sourceBlockHash: BLOCK_HASH,
    totalSupplyRaw: 10_000n,
    balances: evenBalances(100),
    methodologyVersion: '1.0.0',
    rebaseState: 'not_applicable',
    ...overrides,
  };
}

function context(overrides: Partial<HolderAnalysisInput> = {}): RiskScanContext {
  return {
    target: { type: 'token', chainId: 4663, address: TOKEN },
    sourceBlock: 100n,
    sourceBlockHash: BLOCK_HASH,
    methodologyVersion: '1.0.0',
    data: { holderAnalysis: analyzeHolders(input(overrides)) },
    dataSources: [],
  };
}

function rule(id: string): RiskRule {
  const found = createHolderDistributionRules().find((candidate) => candidate.ruleId === id);
  if (found === undefined) throw new Error(`No rule ${id}`);
  return found;
}

async function evaluate(id: string, overrides: Partial<HolderAnalysisInput> = {}) {
  return rule(id).evaluate(context(overrides), new AbortController().signal);
}

describe('holder distribution rules', () => {
  it('passes a widely distributed token', async () => {
    for (const candidate of createHolderDistributionRules()) {
      const result = await candidate.evaluate(context(), new AbortController().signal);
      expect(result.status, `${candidate.ruleId} should pass`).toBe('pass');
    }
  });

  it('fails when one holder controls half of adjusted supply', async () => {
    const result = await evaluate('holder.top1_concentration', {
      balances: [{ address: address(1), balanceRaw: 5_000n }, ...evenBalances(50, 100n)],
    });
    expect(result.status).toBe('fail');
    expect(result.severity).toBe('high');
    expect(result.explanation).toContain('%');
  });

  it('warns between the warning and fail thresholds', async () => {
    // One holder with 3000 of 10000 total: 30%, above the 25% warning, below 50%.
    const result = await evaluate('holder.top1_concentration', {
      balances: [{ address: address(1), balanceRaw: 3_000n }, ...evenBalances(70, 100n)],
    });
    expect(result.status).toBe('warning');
    expect(result.severity).toBe('medium');
  });

  it('excludes verified pool and burn addresses from concentration', async () => {
    const pool = address(999);
    const withPool = await evaluate('holder.top1_concentration', {
      balances: [{ address: pool, balanceRaw: 9_000n }, ...evenBalances(50, 100n)],
      classifications: [
        {
          address: pool,
          addressClass: 'pool',
          verified: true,
          reason: 'Verified DEX pool',
          provenance: 'registry',
        },
      ],
    });
    // The pool holds most of supply, but it is not an insider position.
    expect(withPool.status).toBe('pass');

    const unclassified = await evaluate('holder.top1_concentration', {
      balances: [{ address: pool, balanceRaw: 9_000n }, ...evenBalances(50, 100n)],
    });
    expect(unclassified.status).toBe('fail');
  });

  it('does not exclude an unverified classification', async () => {
    const claimed = address(998);
    const result = await evaluate('holder.top1_concentration', {
      balances: [{ address: claimed, balanceRaw: 9_000n }, ...evenBalances(50, 100n)],
      classifications: [
        {
          address: claimed,
          addressClass: 'treasury',
          verified: false,
          reason: 'Self-reported treasury',
          provenance: 'project_claim',
        },
      ],
    });
    // An unverified claim must not shrink measured concentration.
    expect(result.status).toBe('fail');
  });

  it('withholds a concentration verdict when holder history is incomplete', async () => {
    for (const id of ['holder.top1_concentration', 'holder.top10_concentration']) {
      const result = await evaluate(id, {
        incompleteHistory: true,
        balances: [{ address: address(1), balanceRaw: 9_000n }, ...evenBalances(10, 100n)],
      });
      // The concentration looks damning, but partial history cannot support the claim.
      expect(result.status, `${id} must not conclude on partial history`).toBe('unknown');
      expect(result.confidence.basisPoints).toBe(0);
    }
  });

  it('reports circulating supply as unknown when the rebase state is uncertain', async () => {
    const result = await evaluate('holder.circulating_supply_unknown', {
      rebaseState: 'uncertain',
    });
    expect(result.status).toBe('unknown');
    expect(result.evidence[0]?.data.circulatingSupplyRaw).toBeNull();
  });

  it('reports circulating supply as unknown when total supply is unavailable', async () => {
    const result = await evaluate('holder.circulating_supply_unknown', { totalSupplyRaw: null });
    expect(result.status).toBe('unknown');
  });

  it('never penalises a rule that withheld a conclusion', () => {
    expect(rule('holder.circulating_supply_unknown').maxPenaltyBps).toBe(0);
  });

  it('warns on too few holders', async () => {
    const result = await evaluate('holder.holder_count', { balances: evenBalances(10) });
    expect(result.status).toBe('warning');
    expect(result.explanation).toContain('10 holders');
  });

  it('reports inequality as unknown when no positive balances exist', async () => {
    const result = await evaluate('holder.supply_inequality', { balances: [] });
    expect(result.status).toBe('unknown');
  });

  it('carries provenance and evidence on every finding', async () => {
    for (const candidate of createHolderDistributionRules()) {
      const result = await candidate.evaluate(context(), new AbortController().signal);
      expect(candidate.requiredDataSources).toContain(HOLDER_BALANCES_SOURCE);
      expect(result.evidence[0]?.provenanceKeys).toContain(HOLDER_BALANCES_SOURCE);
    }
  });

  it('is deterministic across repeated evaluations', async () => {
    const overrides = {
      balances: [{ address: address(1), balanceRaw: 5_000n }, ...evenBalances(50, 100n)],
    };
    expect(await evaluate('holder.top1_concentration', overrides)).toEqual(
      await evaluate('holder.top1_concentration', overrides),
    );
  });

  it('rejects malformed analysis data instead of guessing', async () => {
    const malformed: RiskScanContext = { ...context(), data: { holderAnalysis: { nope: true } } };
    await expect(
      rule('holder.holder_count').evaluate(malformed, new AbortController().signal),
    ).rejects.toThrow(/malformed/i);
  });

  it('registers one rule per code with a unique id', () => {
    const rules = createHolderDistributionRules();
    expect(new Set(rules.map((r) => r.ruleId)).size).toBe(rules.length);
    for (const candidate of rules) expect(candidate.category).toBe('Holder distribution');
  });
});
