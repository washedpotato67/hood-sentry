import {
  HOLDER_BALANCES_SOURCE,
  RiskRuleRegistry,
  type RiskRuleset,
  type RiskScanContext,
  RiskScanOrchestrator,
  createHolderDistributionRules,
} from '@hood-sentry/risk-engine';
import { describe, expect, it } from 'vitest';
import {
  type HolderBalanceSource,
  HolderDistributionContextLoader,
  type IndexedBalance,
  balanceAvailability,
} from './holder-distribution-context.js';
import type { RiskScanJobInput } from './risk-scan.js';

const TOKEN = '0x1111111111111111111111111111111111111111';
const POOL = '0x2222222222222222222222222222222222222222';
const WHALE = '0x3333333333333333333333333333333333333333';
const BLOCK = 100n;
const BLOCK_HASH = `0x${'ab'.repeat(32)}`;

function address(index: number): `0x${string}` {
  return `0x${index.toString(16).padStart(40, '0')}` as `0x${string}`;
}

function balance(addr: string, amount: bigint, asOfBlock = BLOCK): IndexedBalance {
  return { address: addr as `0x${string}`, balanceRaw: amount, asOfBlock };
}

function evenBalances(count: number, each = 100n): IndexedBalance[] {
  return Array.from({ length: count }, (_, i) => balance(address(i + 10), each));
}

class FakeSource implements HolderBalanceSource {
  constructor(
    private readonly options: {
      balances?: readonly IndexedBalance[];
      latestTransferBlock?: bigint | null;
      totalSupply?: bigint | null;
      pools?: readonly `0x${string}`[];
    } = {},
  ) {}

  async listBalances(): Promise<readonly IndexedBalance[]> {
    return this.options.balances ?? [];
  }
  async latestTransferBlock(): Promise<bigint | null> {
    return this.options.latestTransferBlock ?? null;
  }
  async totalSupply(): Promise<bigint | null> {
    return this.options.totalSupply ?? 10_000n;
  }
  async listPoolAddresses(): Promise<readonly `0x${string}`[]> {
    return this.options.pools ?? [];
  }
}

const baseContext: RiskScanContext = {
  target: { type: 'token', chainId: 4663, address: TOKEN },
  sourceBlock: BLOCK,
  sourceBlockHash: BLOCK_HASH,
  methodologyVersion: 'risk-v1',
  data: {},
  dataSources: [],
};

const jobInput: RiskScanJobInput = {
  target: { type: 'token', chainId: 4663, address: TOKEN },
  sourceBlock: BLOCK,
  sourceBlockHash: BLOCK_HASH,
  trigger: 'new_token',
};

async function load(source: HolderBalanceSource, context = baseContext) {
  const loader = new HolderDistributionContextLoader({ loadContext: async () => context }, source);
  return loader.loadContext(jobInput, 'risk-v1');
}

function holderSource(context: RiskScanContext) {
  return context.dataSources.find((source) => source.key === HOLDER_BALANCES_SOURCE);
}

async function scan(context: RiskScanContext) {
  const rules = createHolderDistributionRules();
  const ruleset: RiskRuleset = {
    version: 'ruleset-v1',
    methodologyVersion: 'risk-v1',
    rules: rules.map((rule) => ({ ruleId: rule.ruleId, version: rule.version })),
    categoryPenaltyCapsBps: { 'Holder distribution': 3_000 },
  };
  return new RiskScanOrchestrator(new RiskRuleRegistry(rules), 'engine-v1').scan(context, ruleset, {
    scanTimeoutMs: 5_000,
    perRuleTimeoutMs: 1_000,
  });
}

describe('balanceAvailability', () => {
  it('reports an unindexed token as unavailable, not as having no holders', () => {
    expect(
      balanceAvailability({ balances: [], latestTransferBlock: null, sourceBlock: BLOCK }),
    ).toEqual({ status: 'unavailable', reason: 'HOLDER_BALANCES_NOT_INDEXED' });
  });

  it('reports balances written past the scan block as an error', () => {
    const result = balanceAvailability({
      balances: [balance(WHALE, 100n, BLOCK + 1n)],
      latestTransferBlock: null,
      sourceBlock: BLOCK,
    });
    expect(result.status).toBe('error');
    expect(result.reason).toBe('HOLDER_BALANCES_AHEAD_OF_SCAN_BLOCK');
  });

  it('reports balances as stale when a later transfer moved them', () => {
    const result = balanceAvailability({
      balances: [balance(WHALE, 100n, 90n)],
      latestTransferBlock: 95n,
      sourceBlock: BLOCK,
    });
    expect(result.status).toBe('stale');
    expect(result.reason).toBe('HOLDER_BALANCES_BEHIND_SCAN_BLOCK');
  });

  it('accepts balances that lag the scan block with no transfer in between', () => {
    // Nothing moved between the last balance write and the scan block, so the
    // recorded balances still describe the token at that block.
    const result = balanceAvailability({
      balances: [balance(WHALE, 100n, 90n)],
      latestTransferBlock: 90n,
      sourceBlock: BLOCK,
    });
    expect(result.status).toBe('available');
    expect(result.reason).toBeNull();
  });
});

describe('HolderDistributionContextLoader', () => {
  it('supplies a pinned snapshot when balances are current', async () => {
    const context = await load(new FakeSource({ balances: evenBalances(100) }));

    expect(holderSource(context)?.status).toBe('available');
    expect(holderSource(context)?.sourceBlock).toBe(BLOCK);
    expect(holderSource(context)?.sourceBlockHash).toBe(BLOCK_HASH);
    expect(context.data.holderAnalysis).toBeDefined();
  });

  it('excludes pools and burn sinks from insider concentration', async () => {
    const context = await load(
      new FakeSource({
        balances: [balance(POOL, 9_000n), ...evenBalances(50)],
        pools: [POOL as `0x${string}`],
      }),
    );

    const analysis = context.data.holderAnalysis as { adjustedConcentrationBps: { top1: bigint } };
    // The pool holds most of supply, but that is the market, not an insider position.
    expect(analysis.adjustedConcentrationBps.top1).toBeLessThan(2_500n);
  });

  it('counts an unclassified whale as concentration', async () => {
    const context = await load(
      new FakeSource({ balances: [balance(WHALE, 9_000n), ...evenBalances(50)] }),
    );

    const analysis = context.data.holderAnalysis as { adjustedConcentrationBps: { top1: bigint } };
    expect(analysis.adjustedConcentrationBps.top1).toBeGreaterThan(5_000n);
  });

  it('leaves non-token targets untouched', async () => {
    const walletContext: RiskScanContext = {
      ...baseContext,
      target: { type: 'wallet', chainId: 4663, address: TOKEN },
    };
    const context = await load(new FakeSource({ balances: evenBalances(10) }), walletContext);

    expect(holderSource(context)).toBeUndefined();
    expect(context.data.holderAnalysis).toBeUndefined();
  });

  it('does not attach an analysis it cannot pin', async () => {
    const context = await load(new FakeSource({ balances: [] }));

    expect(context.data.holderAnalysis).toBeUndefined();
    expect(holderSource(context)?.status).toBe('unavailable');
  });
});

describe('holder rules over a loaded context', () => {
  it('never scores an unindexed token as clean', async () => {
    const context = await load(new FakeSource({ balances: [] }));
    const result = await scan(context);

    // The whole point: no holder data must read as "nothing wrong", not as an A.
    expect(result.findings.every((finding) => finding.status === 'unknown')).toBe(true);
    expect(result.completeness.status).not.toBe('complete');
    expect(result.completeness.unavailableDataSources).toContain(HOLDER_BALANCES_SOURCE);
    expect(result.score.warnings).toContain('RISK_DATA_INCOMPLETE');
  });

  it('never scores a token whose balances are stale', async () => {
    const context = await load(
      new FakeSource({ balances: [balance(WHALE, 9_000n, 90n)], latestTransferBlock: 95n }),
    );
    const result = await scan(context);

    expect(result.findings.every((finding) => finding.status === 'unknown')).toBe(true);
    expect(result.completeness.status).not.toBe('complete');
  });

  it('scores a well distributed indexed token', async () => {
    const context = await load(new FakeSource({ balances: evenBalances(100) }));
    const result = await scan(context);

    expect(result.completeness.status).toBe('complete');
    expect(result.score.grade).toBe('A');
    expect(result.findings.every((finding) => finding.status === 'pass')).toBe(true);
  });

  it('penalises a concentrated indexed token', async () => {
    const context = await load(
      new FakeSource({ balances: [balance(WHALE, 9_000n), ...evenBalances(50)] }),
    );
    const result = await scan(context);

    expect(result.score.grade).not.toBe('A');
    expect(
      result.findings.filter((finding) => finding.status === 'fail').map((f) => f.ruleId),
    ).toContain('holder.top1_concentration');
  });

  it('does not let a pool-held supply penalise an otherwise healthy token', async () => {
    const context = await load(
      new FakeSource({
        balances: [balance(POOL, 9_000n), ...evenBalances(50)],
        pools: [POOL as `0x${string}`],
      }),
    );
    const result = await scan(context);

    expect(result.score.grade).toBe('A');
  });
});
