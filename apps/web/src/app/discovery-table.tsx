import Link from 'next/link';
import { compactAddress, formatRaw } from '../lib/api';
import { riskGradeClass } from '../lib/risk';
export type DiscoveryItem = {
  address: string;
  name: string | null;
  symbol: string | null;
  priceRaw: string | null;
  priceDecimals: number | null;
  liquidityRaw: string | null;
  liquidityDecimals: number | null;
  liquidityChangeBps: string | null;
  volumeRaw: string | null;
  holderCount: string | null;
  // When the token first appeared on chain; age filters (<24h) read it.
  firstSeenAt: string | null;
  // GeckoTerminal's /pools/ page expects a pool address, not a token address;
  // the feed carries the deepest pool so Trade links land on a real page.
  primaryPoolAddress: string | null;
  // Stripped from the feed while aggregate scoring is withheld, so it's optional.
  riskGrade?: string | null;
  riskCompletenessBps: string | null;
  projectVerified: boolean;
  trending?: { scoreBps?: string };
  warnings?: readonly string[];
  // Attached by best-effort enrichment (finding-severity beads); absent when a
  // token has no scan yet or enrichment failed.
  signals?: { high: number; medium: number; low: number; unavailable: number };
  // Recent liquidity series (oldest→newest) for a sparkline; absent when the
  // token's pools have too few snapshots.
  spark?: number[];
};

// A tiny liquidity trend line, computed server-side (no client JS). Green when
// the latest point is at or above the first, red when it's fallen.
function Sparkline({ points }: { points?: number[] }) {
  if (!points || points.length < 2) return null;
  // An all-zero series draws the same flat line as steady liquidity would, so it
  // would read as a measurement rather than as the absence of one.
  if (points.every((value) => value === 0)) return null;
  const width = 58;
  const height = 16;
  const pad = 2;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = (width - pad * 2) / (points.length - 1);
  const coords = points
    .map((value, index) => {
      const x = pad + index * step;
      const y = pad + (height - pad * 2) * (1 - (value - min) / range);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const first = points[0] ?? 0;
  const last = points[points.length - 1] ?? 0;
  const stroke = last >= first ? 'var(--g-a)' : 'var(--g-f)';
  return (
    <svg
      className="spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <polyline
        points={coords}
        fill="none"
        stroke={stroke}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.9"
      />
    </svg>
  );
}

// ─── Terminal board rows ────────────────────────────────────────────────────
// The dense list rows behind the discovery board: a logo tile, name and meta,// tabular volume/liquidity stats, then price, holders, and a row action. Every
// field is real feed data — no fabricated change or trade counts.

function RowInitials(item: DiscoveryItem): string {
  const source = item.symbol ?? item.name;
  if (!source) return '?';
  const words = source.trim().split(/\s+/);
  if (words.length === 1) return (words[0] ?? '').slice(0, 3).toUpperCase() || '?';
  const first = words[0]?.[0] ?? '';
  const second = words[1]?.[0] ?? '';
  return `${first}${second}`.toUpperCase() || '?';
}

// The worst severity present in a token's finding beads, if any.
function worstSeverity(signals?: DiscoveryItem['signals']): string | null {
  if (!signals) return null;
  if (signals.high > 0) return 'b-high';
  if (signals.medium > 0) return 'b-med';
  if (signals.low > 0) return 'b-low';
  return null;
}

// The row's meta strip: holder count, severity beads, unchecked count, grade.
function TrowMeta({ item, holders }: { item: DiscoveryItem; holders: number | null }) {
  const signals = item.signals;
  const worst = worstSeverity(signals);
  const count = signals ? signals.high + signals.medium + signals.low : 0;
  return (
    <span className="trow-meta">
      {holders === null ? <span>·</span> : <span>{holders.toLocaleString('en-US')} holders</span>}
      {worst !== null && count > 0 ? (
        <span className="sig">
          <span className={`bead ${worst}`} aria-hidden="true" />
          <span>{count}</span>
        </span>
      ) : null}
      {signals !== undefined && signals.unavailable > 0 ? (
        <span title="Rules the analyzer could not run against this token">
          {signals.unavailable} unchecked
        </span>
      ) : null}
      {item.riskGrade ? (
        <span className={`trow-risk ${riskGradeClass(item.riskGrade)}`}>{item.riskGrade}</span>
      ) : null}
    </span>
  );
}

// The one trade action everywhere: GeckoTerminal's pool page for this token.
// The pool address is what GeckoTerminal routes on; the token address is the
// fallback for tokens without an indexed or aggregated pool yet.
export function TradeLink({
  pool,
  token,
  className = 'trow-trade',
}: {
  pool: string | null;
  token: string;
  className?: string;
}) {
  return (
    <a
      className={className}
      href={`https://www.geckoterminal.com/robinhood/pools/${pool ?? token}`}
      target="_blank"
      rel="noreferrer noopener"
    >
      Trade
    </a>
  );
}

export function DiscoveryRow({ item }: { item: DiscoveryItem }) {
  const price = formatRaw(item.priceRaw, item.priceDecimals);
  const holders = item.holderCount === null ? null : Number(item.holderCount);
  return (
    <div className="trow">
      <Link className="trow-fill" href={`/token/${item.address}`}>
        <span className="trow-main">
          <span className="trow-logo">{RowInitials(item)}</span>
          <span className="trow-id">
            <span className="trow-name">
              <strong>{item.symbol ?? item.name ?? 'Unknown token'}</strong>
              <code>{compactAddress(item.address)}</code>
            </span>
            <TrowMeta item={item} holders={holders} />
          </span>
        </span>
        <span className="trow-stats">
          <span className="trow-stat">
            <b className="stat-v">V</b>
            <span>{formatRaw(item.volumeRaw)}</span>
          </span>
          <span className="trow-stat">
            <b className="stat-lq">LQ</b>
            <span>{formatRaw(item.liquidityRaw)}</span>
          </span>
        </span>
        <span className="trow-foot">
          <span className="trow-price">{price === 'Unavailable' ? '·' : price}</span>
          <Sparkline points={item.spark} />
        </span>
      </Link>
      <TradeLink pool={item.primaryPoolAddress} token={item.address} />
    </div>
  );
}
