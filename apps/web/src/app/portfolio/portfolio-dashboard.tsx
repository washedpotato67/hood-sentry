'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiRequest, chainId, compactAddress, formatRaw } from '../../lib/api';
import { Stat } from '../components';
import { useSession } from '../use-session';

type Portfolio = {
  address: string;
  nativeBalance: { balanceRaw: string; decimals: number };
  holdings: readonly {
    tokenAddress: string;
    symbol: string | null;
    name: string | null;
    decimals: number | null;
    balanceRaw: string;
    estimatedValueRaw: string | null;
  }[];
  valuation: {
    status: string;
    totalEstimatedValueRaw: string | null;
    decimals: number | null;
    unpricedHoldingCount: number;
  };
};

type Pnl = {
  status: string;
  positions: readonly {
    tokenAddress: string;
    quoteAssetAddress: string;
    quoteDecimals: number;
    costBasisRaw: string | null;
    realizedPnlRaw: string | null;
    unrealizedPnlRaw: string | null;
    confidence: string;
    warnings: readonly string[];
    snapshotBlock: string;
  }[];
};

export function PortfolioDashboard() {
  const { session } = useSession();
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [pnl, setPnl] = useState<Pnl | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chain = chainId();
  const wallet = session?.wallets.find((entry) => entry.chainId === chain && entry.isPrimary);

  useEffect(() => {
    if (wallet === undefined) return;
    void Promise.all([
      apiRequest<Portfolio>(`/v1/wallets/${wallet.address}/portfolio?chainId=${chain}`),
      apiRequest<Pnl>(`/v1/wallets/${wallet.address}/pnl?chainId=${chain}`),
    ]).then(([portfolioResult, pnlResult]) => {
      if (portfolioResult.ok) setPortfolio(portfolioResult.data);
      else setError(portfolioResult.message);
      if (pnlResult.ok) setPnl(pnlResult.data);
    });
  }, [wallet, chain]);

  if (session === null) return <p className="muted">Loading session…</p>;
  if (!session.authenticated || wallet === undefined) {
    return <p className="unavailable">Connect and sign in with a Robinhood Chain wallet.</p>;
  }
  if (error !== null) return <p className="danger">{error}</p>;
  if (portfolio === null) return <p className="muted">Loading indexed portfolio…</p>;
  return (
    <div className="stack">
      <p className="muted">Primary wallet {compactAddress(portfolio.address)}</p>
      <div className="grid">
        <Stat label="ETH" value={formatRaw(portfolio.nativeBalance.balanceRaw, 18)} />
        <Stat
          label="Estimated value"
          value={formatRaw(
            portfolio.valuation.totalEstimatedValueRaw,
            portfolio.valuation.decimals,
          )}
        />
        <Stat label="Valuation status" value={portfolio.valuation.status} />
        <Stat
          label="Unpriced holdings"
          value={portfolio.valuation.unpricedHoldingCount.toString()}
        />
      </div>
      <section className="panel">
        <h2>Holdings</h2>
        {portfolio.holdings.length === 0 ? (
          <p className="muted">No positive indexed balances.</p>
        ) : null}
        {portfolio.holdings.map((holding) => (
          <div className="metric-row" key={holding.tokenAddress}>
            <Link href={`/token/${holding.tokenAddress}`}>
              {holding.symbol ?? holding.name ?? compactAddress(holding.tokenAddress)}
            </Link>
            <span>{formatRaw(holding.balanceRaw, holding.decimals)}</span>
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>Estimated FIFO P&amp;L</h2>
        {pnl === null || pnl.positions.length === 0 ? (
          <p className="muted">No verified-pair trade history is available.</p>
        ) : null}
        {pnl?.positions.map((position) => (
          <div className="metric-row" key={position.tokenAddress}>
            <span>
              <Link href={`/token/${position.tokenAddress}`}>
                {compactAddress(position.tokenAddress)}
              </Link>
              <br />
              <small className="muted">
                Confidence {position.confidence}, block {position.snapshotBlock}
              </small>
              {position.warnings.length === 0 ? null : (
                <small className="warning"> {position.warnings.join(', ')}</small>
              )}
            </span>
            <span>
              Cost {formatRaw(position.costBasisRaw, position.quoteDecimals)}
              <br />
              Realized {formatRaw(position.realizedPnlRaw, position.quoteDecimals)}
              <br />
              Unrealized {formatRaw(position.unrealizedPnlRaw, position.quoteDecimals)}
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}
