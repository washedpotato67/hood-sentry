/**
 * Deterministic risk findings computed from a token's live facts — the lean
 * stand-in for the deferred, DB-coupled 12-domain scan. It emits individual
 * evidence-backed findings across a few domains (holder distribution, liquidity,
 * market integrity, contract control) but never an aggregate grade: coverage is
 * partial by design, so the score stays withheld.
 *
 * Pure: given the facts, it returns findings. It sources nothing itself.
 */

export type LiveRiskSeverity = 'high' | 'medium' | 'low' | 'info';

export type LiveRiskFinding = {
  id: string;
  category: string;
  severity: LiveRiskSeverity;
  confidence: string;
  title: string;
  explanation: string;
  evidence: readonly { label: string; value: string }[];
};

export type LiveRiskInput = {
  liquidityUsd: string | null;
  volume24hUsd: string | null;
  poolCount: number;
  totalSupplyRaw: string | null;
  /** Top holders, deepest first, as the explorer returns them. */
  topHolders: readonly { address: string; balanceRaw: string }[];
  /** Null when the explorer did not answer — treated as unknown, not a signal. */
  contract: { verified: boolean; isProxy: boolean } | null;
};

function toNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Percent of `whole` that `part` represents, to one decimal; null if no supply. */
function percentOf(part: bigint, whole: bigint): number | null {
  if (whole <= 0n) return null;
  return Number((part * 1_000n) / whole) / 10;
}

function usd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

/** The findings for a token's live facts, worst-first is applied by the caller. */
export function computeLiveRiskFindings(input: LiveRiskInput): LiveRiskFinding[] {
  const findings: LiveRiskFinding[] = [];

  // Holder distribution — concentration of supply in the largest wallets.
  const first = input.topHolders[0];
  if (input.totalSupplyRaw !== null && first !== undefined) {
    const supply = BigInt(input.totalSupplyRaw);
    const top1 = percentOf(BigInt(first.balanceRaw), supply);
    const top10 = percentOf(
      input.topHolders.slice(0, 10).reduce((sum, h) => sum + BigInt(h.balanceRaw), 0n),
      supply,
    );
    if (top1 !== null) {
      const evidence = [
        { label: 'Top holder', value: `${top1.toFixed(1)}%` },
        ...(top10 === null ? [] : [{ label: 'Top 10 holders', value: `${top10.toFixed(1)}%` }]),
      ];
      if (top1 > 50) {
        findings.push({
          id: 'holder-concentration',
          category: 'Holder distribution',
          severity: 'high',
          confidence: 'high',
          title: 'Supply is highly concentrated',
          explanation: `The single largest wallet holds ${top1.toFixed(1)}% of supply and could move the market or exit into your trade.`,
          evidence,
        });
      } else if (top1 > 25 || (top10 ?? 0) > 75) {
        findings.push({
          id: 'holder-concentration',
          category: 'Holder distribution',
          severity: 'medium',
          confidence: 'high',
          title: 'Supply is moderately concentrated',
          explanation: `Large holders control a sizable share of supply (top holder ${top1.toFixed(1)}%${top10 === null ? '' : `, top 10 ${top10.toFixed(1)}%`}), which can amplify volatility.`,
          evidence,
        });
      }
    }
  }

  // Liquidity — how easily the floor can be pulled.
  const liquidity = toNumber(input.liquidityUsd);
  if (liquidity !== null) {
    if (liquidity < 10_000) {
      findings.push({
        id: 'thin-liquidity',
        category: 'Liquidity',
        severity: 'high',
        confidence: 'high',
        title: 'Very thin liquidity',
        explanation: `On-chain liquidity is only ${usd(liquidity)}, so even small trades move the price sharply and the floor is easy to pull.`,
        evidence: [{ label: 'Liquidity', value: usd(liquidity) }],
      });
    } else if (liquidity < 50_000) {
      findings.push({
        id: 'thin-liquidity',
        category: 'Liquidity',
        severity: 'medium',
        confidence: 'high',
        title: 'Shallow liquidity',
        explanation: `Liquidity of ${usd(liquidity)} is modest; larger orders will slip and exiting a position may be costly.`,
        evidence: [{ label: 'Liquidity', value: usd(liquidity) }],
      });
    }
  }

  // Liquidity — a single pool is a single point of failure.
  if (input.poolCount === 1) {
    findings.push({
      id: 'single-pool',
      category: 'Liquidity',
      severity: 'medium',
      confidence: 'high',
      title: 'Liquidity sits in a single pool',
      explanation:
        'All routing depends on one pool, so a single liquidity removal or manipulation affects the whole market.',
      evidence: [{ label: 'Pools', value: '1' }],
    });
  }

  // Market integrity — volume far above liquidity hints at wash trading or churn.
  const volume = toNumber(input.volume24hUsd);
  if (liquidity !== null && liquidity > 0 && volume !== null) {
    const ratio = volume / liquidity;
    if (ratio > 10) {
      findings.push({
        id: 'volume-liquidity-imbalance',
        category: 'Market integrity',
        severity: 'medium',
        confidence: 'high',
        title: 'Volume far exceeds liquidity',
        explanation: `24h volume is ${ratio.toFixed(0)}× the pool's liquidity, which can indicate wash trading or unstable, churning markets rather than organic demand.`,
        evidence: [
          { label: '24h volume', value: usd(volume) },
          { label: 'Liquidity', value: usd(liquidity) },
          { label: 'Ratio', value: `${ratio.toFixed(0)}×` },
        ],
      });
    }
  }

  // Contract control — verification and upgradeability.
  if (input.contract !== null) {
    if (!input.contract.verified) {
      findings.push({
        id: 'unverified-contract',
        category: 'Contract control',
        severity: 'medium',
        confidence: 'high',
        title: 'Contract source is not verified',
        explanation:
          'The contract source is not published on the block explorer, so its behavior cannot be inspected before you trade.',
        evidence: [{ label: 'Source', value: 'Unverified' }],
      });
    }
    if (input.contract.isProxy) {
      findings.push({
        id: 'proxy-contract',
        category: 'Contract control',
        severity: 'medium',
        confidence: 'high',
        title: 'Contract is an upgradeable proxy',
        explanation:
          'The token is a proxy, so its logic can be changed after you buy — rules that hold today may not hold tomorrow.',
        evidence: [{ label: 'Proxy', value: 'Yes' }],
      });
    }
  }

  // Never leave the section empty or ambiguous: an explicit all-clear reads as a
  // checked result, not an absence of data.
  if (findings.length === 0) {
    findings.push({
      id: 'no-elevated-signals',
      category: 'Overview',
      severity: 'info',
      confidence: 'high',
      title: 'No elevated risk signals from live data',
      explanation:
        'The live checks — holder concentration, liquidity depth, pool count, volume-to-liquidity, and contract verification — found nothing elevated. Coverage is partial; this is not an audit.',
      evidence: [],
    });
  }

  return findings;
}

/**
 * Wraps the findings in the shape the token route already returns for `risk`, so
 * the page's existing findings UI renders them. The aggregate grade stays
 * withheld — coverage is partial by design.
 */
export function serializeLiveRisk(findings: readonly LiveRiskFinding[]): Record<string, unknown> {
  return {
    status: 'partial',
    source: 'live',
    score: null,
    scoreStatus: 'WITHHELD_PENDING_RULE_COVERAGE',
    findings,
    notice:
      'Live evidence signals from current market and on-chain data. Partial coverage — not a full audit or financial advice.',
  };
}
