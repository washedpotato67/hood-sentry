import Link from 'next/link';
import { apiRequest, chainId, compactAddress, formatRaw } from '../../../lib/api';
import { ErrorPanel, Page, Stat, Unavailable } from '../../components';

type Portfolio = {
  address: string;
  nativeBalance: { balanceRaw: string; decimals: number; status: string };
  holdings: readonly {
    tokenAddress: string;
    symbol: string | null;
    name: string | null;
    decimals: number | null;
    balanceRaw: string;
    estimatedValueRaw: string | null;
    valueStatus: string;
  }[];
  valuation: {
    status: string;
    totalEstimatedValueRaw: string | null;
    decimals: number | null;
    unpricedHoldingCount: number;
  };
};

type Allowance = {
  tokenAddress: string;
  spenderAddress: string;
  allowanceRaw: string;
  spenderClassification: string | null;
  classificationStatus: string;
};

type Activity = {
  transactionHash: string;
  direction: string;
  tokenAddress: string;
  amountRaw: string;
  blockNumber: string;
};

type Pnl = {
  status: string;
  methodology: string;
  positions: readonly {
    tokenAddress: string;
    quoteAssetAddress: string;
    quoteDecimals: number;
    balanceRaw: string;
    costBasisRaw: string | null;
    realizedPnlRaw: string | null;
    unrealizedPnlRaw: string | null;
    confidence: string;
    incompleteHistory: boolean;
    warnings: readonly string[];
    snapshotBlock: string;
  }[];
};

export default async function Wallet({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const chain = chainId();
  const [portfolio, allowances, activity, pnl] = await Promise.all([
    apiRequest<Portfolio>(`/v1/wallets/${encodeURIComponent(address)}/portfolio?chainId=${chain}`),
    apiRequest<readonly Allowance[]>(
      `/v1/wallets/${encodeURIComponent(address)}/allowances?chainId=${chain}`,
    ),
    apiRequest<readonly Activity[]>(
      `/v1/wallets/${encodeURIComponent(address)}/activity?chainId=${chain}&limit=20`,
    ),
    apiRequest<Pnl>(`/v1/wallets/${encodeURIComponent(address)}/pnl?chainId=${chain}`),
  ]);
  if (!portfolio.ok) {
    return (
      <Page title="Wallet lookup">
        <ErrorPanel code={portfolio.code} message={portfolio.message} />
      </Page>
    );
  }
  const data = portfolio.data;
  return (
    <Page title="Public wallet">
      <p className="lede">
        Address: <code>{data.address}</code>
      </p>
      <div className="grid">
        <Stat label="ETH balance" value={formatRaw(data.nativeBalance.balanceRaw, 18)} />
        <Stat
          label="Estimated value"
          value={formatRaw(data.valuation.totalEstimatedValueRaw, data.valuation.decimals)}
        />
        <Stat label="Holdings" value={data.holdings.length.toString()} />
        <Stat
          label="Active approvals"
          value={
            allowances.ok
              ? allowances.data.filter((item) => item.allowanceRaw !== '0').length.toString()
              : undefined
          }
        />
      </div>
      <section className="panel">
        <h2>Holdings</h2>
        {data.holdings.length === 0 ? <Unavailable label="Positive token balances" /> : null}
        {data.holdings.map((holding) => (
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
        {!pnl.ok || pnl.data.positions.length === 0 ? (
          <Unavailable label="Trade cost basis" />
        ) : null}
        {pnl.ok
          ? pnl.data.positions.map((position) => (
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
            ))
          : null}
      </section>
      <section className="panel">
        <h2>Token approvals</h2>
        {allowances.ok ? (
          allowances.data.map((allowance) => (
            <div
              className="metric-row"
              key={`${allowance.tokenAddress}:${allowance.spenderAddress}`}
            >
              <span>
                <Link href={`/token/${allowance.tokenAddress}`}>
                  {compactAddress(allowance.tokenAddress)}
                </Link>
                <br />
                <small className="muted">Spender {compactAddress(allowance.spenderAddress)}</small>
              </span>
              <span className={allowance.classificationStatus === 'unknown' ? 'warning' : ''}>
                {allowance.allowanceRaw === '0'
                  ? 'Revoked'
                  : (allowance.spenderClassification ?? 'Unknown spender')}
              </span>
            </div>
          ))
        ) : (
          <Unavailable label="Approval history" />
        )}
      </section>
      <section className="panel">
        <h2>Recent transfers</h2>
        {activity.ok ? (
          activity.data.map((entry) => (
            <div className="metric-row" key={`${entry.transactionHash}:${entry.tokenAddress}`}>
              <span>
                {entry.direction.toUpperCase()} {compactAddress(entry.tokenAddress)}
              </span>
              <code>{compactAddress(entry.transactionHash)}</code>
            </div>
          ))
        ) : (
          <Unavailable label="Wallet activity" />
        )}
      </section>
    </Page>
  );
}
