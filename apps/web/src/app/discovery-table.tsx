import Link from 'next/link';
import { compactAddress, formatRaw } from '../lib/api';
import { riskGradeClass } from '../lib/risk';
import { EmptyState } from './components';

export type DiscoveryItem = {
  address: string;
  name: string | null;
  symbol: string | null;
  priceRaw: string | null;
  priceDecimals: number | null;
  liquidityRaw: string | null;
  volumeRaw: string | null;
  holderCount: string | null;
  // Stripped from the feed while aggregate scoring is withheld, so it's optional.
  riskGrade?: string | null;
  riskCompletenessBps: string | null;
  projectVerified: boolean;
  trending?: { scoreBps?: string };
  warnings?: readonly string[];
  // Attached by best-effort enrichment (finding-severity beads); absent when a
  // token has no scan yet or enrichment failed.
  signals?: { high: number; medium: number; low: number };
  // Recent liquidity series (oldest→newest) for a sparkline; absent when the
  // token's pools have too few snapshots.
  spark?: number[];
};

// A tiny liquidity trend line, computed server-side (no client JS). Green when
// the latest point is at or above the first, amber when it's fallen.
function Sparkline({ points }: { points?: number[] }) {
  if (!points || points.length < 2) return null;
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
  const stroke = last >= first ? 'var(--g-a)' : 'var(--g-d)';
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

// Compact severity beads: a colored dot at the worst level present, with counts.
// "Clean" reads as an em-dash — no scan findings, not missing data.
function Signals({ signals }: { signals?: DiscoveryItem['signals'] }) {
  if (!signals || signals.high + signals.medium + signals.low === 0) {
    return <span className="muted">—</span>;
  }
  const parts: string[] = [];
  if (signals.high > 0) parts.push(`${signals.high} high`);
  if (signals.medium > 0) parts.push(`${signals.medium} med`);
  if (signals.low > 0) parts.push(`${signals.low} low`);
  const worst = signals.high > 0 ? 'b-high' : signals.medium > 0 ? 'b-med' : 'b-low';
  return (
    <span className="sig">
      <span className={`bead ${worst}`} aria-hidden="true" />
      <span className="count">{parts.join(' · ')}</span>
    </span>
  );
}

export function DiscoveryTable({ items }: { items: readonly DiscoveryItem[] }) {
  if (items.length === 0)
    return (
      <EmptyState
        title="Nothing indexed here yet"
        action={<Link href="/methodology">How ranking works →</Link>}
      >
        Sentry is catching up to the chain head — tokens surface here as their on-chain evidence
        lands. Check back shortly, or read how the ranking works.
      </EmptyState>
    );
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Token</th>
            <th>Price</th>
            <th>Liquidity</th>
            <th>Volume</th>
            <th>Holders</th>
            <th>Risk</th>
            <th>Signals</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.address} className="table-row-link">
              <td>
                <Link href={`/token/${item.address}`}>
                  <strong>{item.symbol ?? item.name ?? 'Unknown token'}</strong>
                  <br />
                  <code className="muted">{compactAddress(item.address)}</code>
                </Link>
              </td>
              <td>{formatRaw(item.priceRaw, item.priceDecimals)}</td>
              <td className="liq-cell">
                <Sparkline points={item.spark} />
                {formatRaw(item.liquidityRaw)}
              </td>
              <td>{formatRaw(item.volumeRaw)}</td>
              <td>{item.holderCount ?? 'Unavailable'}</td>
              <td>
                <span
                  className={riskGradeClass(item.riskGrade)}
                  title={
                    item.riskGrade
                      ? undefined
                      : 'Aggregate grade withheld until rule coverage is complete'
                  }
                >
                  {item.riskGrade ?? '—'}
                </span>
              </td>
              <td>
                <Signals signals={item.signals} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
