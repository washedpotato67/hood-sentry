import Link from 'next/link';
import { compactAddress, formatRaw } from '../lib/api';

export type DiscoveryItem = {
  address: string;
  name: string | null;
  symbol: string | null;
  priceRaw: string | null;
  priceDecimals: number | null;
  liquidityRaw: string | null;
  volumeRaw: string | null;
  holderCount: string | null;
  riskGrade: string;
  riskCompletenessBps: string | null;
  projectVerified: boolean;
  trending?: { scoreBps?: string };
  warnings?: readonly string[];
};

export function DiscoveryTable({ items }: { items: readonly DiscoveryItem[] }) {
  if (items.length === 0) return <p className="muted">No indexed tokens match this view.</p>;
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
              <td>{formatRaw(item.liquidityRaw)}</td>
              <td>{formatRaw(item.volumeRaw)}</td>
              <td>{item.holderCount ?? 'Unavailable'}</td>
              <td>
                <span className="badge">{item.riskGrade}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
