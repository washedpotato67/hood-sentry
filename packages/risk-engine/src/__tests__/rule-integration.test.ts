import { describe, expect, it } from 'vitest';
import { analyzeHolders } from '../holder-analysis.js';
import { HOLDER_BALANCES_SOURCE, createHolderDistributionRules } from '../holder-rules.js';
import type { HolderBalance } from '../holder-types.js';
import { analyzeLiquidityRisk } from '../liquidity-risk.js';
import { LIQUIDITY_STATE_SOURCE, createLiquidityRiskRules } from '../liquidity-rules.js';
import { RiskScanOrchestrator } from '../orchestrator.js';
import { RiskRuleRegistry } from '../registry.js';
import type { RiskDataSource, RiskRule, RiskRuleset, RiskScanContext } from '../types.js';

/**
 * The rule families are only useful if they register into a ruleset and produce a
 * score through the real orchestrator. These tests run them end to end.
 */

const TOKEN = '0x1111111111111111111111111111111111111111' as const;
const WHALE = '0x2222222222222222222222222222222222222222' as const;
const CREATOR = '0x3333333333333333333333333333333333333333' as const;
const BLOCK = 100n;
const BLOCK_HASH = `0x${'ef'.repeat(32)}` as const;

function address(index: number): `0x${string}` {
  return `0x${index.toString(16).padStart(40, '0')}` as `0x${string}`;
}

function balances(count: number): HolderBalance[] {
  return Array.from({ length: count }, (_, i) => ({ address: address(i + 1), balanceRaw: 100n }));
}

function source(key: string, status: RiskDataSource['status'] = 'available'): RiskDataSource {
  return {
    key,
    kind: key === LIQUIDITY_STATE_SOURCE ? 'protocol' : 'chain',
    provider: 'test',
    status,
    sourceBlock: BLOCK,
    sourceBlockHash: BLOCK_HASH,
    fetchedAt: '2026-07-15T12:00:00.000Z',
    reason: status === 'available' ? null : 'provider down',
  };
}

function healthyContext(dataSources?: RiskDataSource[]): RiskScanContext {
  return {
    target: { type: 'token', chainId: 4663, address: TOKEN },
    sourceBlock: BLOCK,
    sourceBlockHash: BLOCK_HASH,
    methodologyVersion: 'risk-v1',
    data: {
      holderAnalysis: analyzeHolders({
        chainId: 4663,
        tokenAddress: TOKEN,
        sourceBlock: BLOCK,
        sourceBlockHash: BLOCK_HASH,
        totalSupplyRaw: 10_000n,
        balances: balances(100),
        methodologyVersion: 'risk-v1',
        rebaseState: 'not_applicable',
      }),
      liquidityAnalysis: analyzeLiquidityRisk({
        chainId: 4663,
        poolAddress: address(500),
        protocolKey: 'verified-dex',
        poolType: 'v2',
        quoteAsset: address(501),
        verifiedProtocol: true,
        sourceBlock: BLOCK,
        sourceBlockHash: BLOCK_HASH,
        poolAgeBlocks: 1_000n,
        tokenLiquidityRaw: 1_000n,
        quoteLiquidityRaw: 1_000n,
        currentLiquidityRaw: 1_000n,
        burnedLiquidityRaw: 0n,
        burnedProviders: [],
        priceImpactBps: 10n,
        providers: [
          { address: address(600), liquidityRaw: 600n },
          { address: address(601), liquidityRaw: 400n },
        ],
        ownership: { kind: 'locked', lockContract: address(700), verified: true },
        removalsRaw: 0n,
        additionsRaw: 1_000n,
        removalEvents: [],
      }),
    },
    dataSources: dataSources ?? [source(HOLDER_BALANCES_SOURCE), source(LIQUIDITY_STATE_SOURCE)],
  };
}

/** A token whose creator holds the LP position and whose supply sits with one whale. */
function riskyContext(): RiskScanContext {
  return {
    ...healthyContext(),
    data: {
      holderAnalysis: analyzeHolders({
        chainId: 4663,
        tokenAddress: TOKEN,
        sourceBlock: BLOCK,
        sourceBlockHash: BLOCK_HASH,
        totalSupplyRaw: 10_000n,
        balances: [{ address: WHALE, balanceRaw: 9_000n }, ...balances(10)],
        methodologyVersion: 'risk-v1',
        rebaseState: 'not_applicable',
      }),
      liquidityAnalysis: analyzeLiquidityRisk({
        chainId: 4663,
        poolAddress: address(500),
        protocolKey: 'verified-dex',
        poolType: 'v2',
        quoteAsset: address(501),
        verifiedProtocol: true,
        sourceBlock: BLOCK,
        sourceBlockHash: BLOCK_HASH,
        poolAgeBlocks: 10n,
        tokenLiquidityRaw: 1_000n,
        quoteLiquidityRaw: 1_000n,
        currentLiquidityRaw: 1_000n,
        burnedLiquidityRaw: 0n,
        burnedProviders: [],
        priceImpactBps: 500n,
        providers: [{ address: CREATOR, liquidityRaw: 1_000n }],
        ownership: { kind: 'creator', owner: CREATOR, verified: true },
        removalsRaw: 600n,
        additionsRaw: 1_000n,
        removalEvents: [],
      }),
    },
  };
}

function allRules(): readonly RiskRule[] {
  return [...createLiquidityRiskRules(), ...createHolderDistributionRules()];
}

function ruleset(rules: readonly RiskRule[]): RiskRuleset {
  return {
    version: 'ruleset-v1',
    methodologyVersion: 'risk-v1',
    rules: rules.map((rule) => ({ ruleId: rule.ruleId, version: rule.version })),
    categoryPenaltyCapsBps: { Liquidity: 3_000, 'Holder distribution': 3_000 },
  };
}

async function scan(context: RiskScanContext) {
  const rules = allRules();
  return new RiskScanOrchestrator(new RiskRuleRegistry(rules), 'engine-v1').scan(
    context,
    ruleset(rules),
    { scanTimeoutMs: 5_000, perRuleTimeoutMs: 1_000 },
  );
}

describe('liquidity and holder rules end to end', () => {
  it('registers every rule into a ruleset', () => {
    const rules = allRules();
    const registry = new RiskRuleRegistry(rules);
    const resolved = registry.resolveRuleset(ruleset(rules));
    expect(resolved.rules).toHaveLength(rules.length);
  });

  it('scores a healthy token as complete with no penalty', async () => {
    const result = await scan(healthyContext());

    expect(result.status).toBe('completed');
    expect(result.completeness.status).toBe('complete');
    expect(result.score.scoreBps).toBe(10_000);
    expect(result.score.grade).toBe('A');
    expect(result.findings.every((finding) => finding.status === 'pass')).toBe(true);
  });

  it('penalises a token whose creator holds liquidity and whose supply is concentrated', async () => {
    const result = await scan(riskyContext());

    expect(result.score.scoreBps).toBeLessThan(10_000);
    expect(result.score.grade).not.toBe('A');

    const failed = result.findings.filter((finding) => finding.status === 'fail');
    expect(failed.map((finding) => finding.ruleId).sort()).toEqual([
      'holder.top10_concentration',
      'holder.top1_concentration',
      'liquidity.abrupt_liquidity_removal',
      'liquidity.removable_creator_liquidity',
    ]);
  });

  it('caps the penalty a single category can contribute', async () => {
    const capped = await scan(riskyContext());
    // This token trips enough rules in both categories to exceed the 3000bps cap, so
    // each category lands exactly on the cap rather than summing past it.
    expect(capped.score.categoryScoresBps.Liquidity).toBe(7_000);
    expect(capped.score.categoryScoresBps['Holder distribution']).toBe(7_000);

    // Raising the cap must move the score, otherwise the cap was not binding and this
    // test would prove nothing.
    const rules = allRules();
    const generous: RiskRuleset = {
      ...ruleset(rules),
      categoryPenaltyCapsBps: { Liquidity: 10_000, 'Holder distribution': 10_000 },
    };
    const uncapped = await new RiskScanOrchestrator(new RiskRuleRegistry(rules), 'engine-v1').scan(
      riskyContext(),
      generous,
      { scanTimeoutMs: 5_000, perRuleTimeoutMs: 1_000 },
    );
    expect(uncapped.score.scoreBps).toBeLessThan(capped.score.scoreBps);
  });

  it('attaches pinned provenance to every finding', async () => {
    const result = await scan(healthyContext());
    for (const finding of result.findings) {
      expect(finding.dataProvenance.length, `${finding.ruleId} needs provenance`).toBeGreaterThan(
        0,
      );
      for (const provenance of finding.dataProvenance) {
        expect(provenance.sourceBlock).toBe(BLOCK);
        expect(provenance.sourceBlockHash).toBe(BLOCK_HASH);
      }
    }
  });

  it('reports unknown instead of a score when holder data is unavailable', async () => {
    const result = await scan(
      healthyContext([
        source(HOLDER_BALANCES_SOURCE, 'unavailable'),
        source(LIQUIDITY_STATE_SOURCE),
      ]),
    );

    const holderFindings = result.findings.filter((finding) =>
      finding.ruleId.startsWith('holder.'),
    );
    expect(holderFindings.length).toBeGreaterThan(0);
    // Unavailable data must never be reported as a clean result.
    expect(holderFindings.every((finding) => finding.status === 'unknown')).toBe(true);
    expect(result.completeness.status).not.toBe('complete');
    expect(result.completeness.unavailableDataSources).toContain(HOLDER_BALANCES_SOURCE);
  });

  it('produces byte-identical results across repeated scans', async () => {
    const first = await scan(riskyContext());
    const second = await scan(riskyContext());
    expect(first.findings).toEqual(second.findings);
    expect(first.score).toEqual(second.score);
  });
});
