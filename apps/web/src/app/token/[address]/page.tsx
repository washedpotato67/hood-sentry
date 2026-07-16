import Link from 'next/link';
import { apiRequest, chainId, compactAddress, formatRaw } from '../../../lib/api';
import { ErrorPanel, Page, Stat, Unavailable } from '../../components';
import { CommentaryPanel } from './commentary-panel';
import { ReportForm } from './report-form';

type Finding = {
  id: string;
  severity: string;
  title: string;
  explanation: string;
  confidence: string;
  evidence: readonly unknown[];
};

type Risk = {
  status: string;
  score?: {
    value: number;
    grade: string;
    completenessPercent: number;
    unresolvedDataWarnings: readonly string[];
  } | null;
  findings?: readonly Finding[];
  reason?: string;
};

type TokenData = {
  chainId: number;
  address: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupplyRaw: string | null;
  metadataStatus: string;
  spamStatus: string;
  poolCount: number;
  contract: { verified: boolean; isProxy: boolean } | null;
  risk: Risk;
};

type HolderData = {
  holders: readonly { address: string; balanceRaw: string; supplyShareBps: string | null }[];
};

type PriceData = {
  status: string;
  priceRaw: string | null;
  priceDecimals: number | null;
  source: string;
  confidenceBps: string;
  warnings: readonly string[];
};

const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';

export default async function Token({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const chain = chainId();
  const [token, holders, price] = await Promise.all([
    apiRequest<TokenData>(`/v1/tokens/${encodeURIComponent(address)}?chainId=${chain}`),
    apiRequest<HolderData>(
      `/v1/tokens/${encodeURIComponent(address)}/holders?chainId=${chain}&limit=20`,
    ),
    chain === 4663
      ? apiRequest<PriceData>(
          `/v1/tokens/${encodeURIComponent(address)}/price?chainId=${chain}&quoteAssetAddress=${USDG}`,
        )
      : Promise.resolve({
          ok: false as const,
          status: 503,
          code: 'PRICE_SOURCE_UNAVAILABLE',
          message: 'No verified testnet quote asset is configured.',
        }),
  ]);
  if (!token.ok) {
    return (
      <Page title="Token lookup">
        <ErrorPanel code={token.code} message={token.message} />
      </Page>
    );
  }
  const data = token.data;
  const risk = data.risk;
  const score = risk.score ?? null;
  return (
    <Page title={data.name ?? data.symbol ?? 'Token'}>
      <p className="lede">
        {data.symbol === null ? null : <strong>{data.symbol} · </strong>}
        <code>{data.address}</code>
      </p>
      <div className="actions">
        <Link href={`/trade?input=${data.address}`}>Prepare trade</Link>
        <Link href={`/wallet/${data.address}`}>Inspect as wallet</Link>
      </div>
      <div className="grid">
        <Stat
          label="USDG price"
          value={price.ok ? formatRaw(price.data.priceRaw, price.data.priceDecimals) : undefined}
        />
        <Stat label="Pools" value={data.poolCount.toString()} />
        <Stat
          label="Indexed holders"
          value={holders.ok ? holders.data.holders.length.toString() : undefined}
        />
        <Stat label="Risk grade" value={score?.grade} />
        <Stat
          label="Completeness"
          value={score === null ? undefined : `${score.completenessPercent}%`}
        />
        <Stat label="Contract source" value={data.contract?.verified ? 'Verified' : 'Unverified'} />
      </div>
      <section className="panel">
        <h2>Evidence-backed risk report</h2>
        {risk.status === 'unavailable' ? (
          <Unavailable label={risk.reason ?? 'Completed scan'} />
        ) : (
          <ul className="risk-list">
            {(risk.findings ?? []).map((finding) => (
              <li className="risk-item" key={finding.id}>
                <div className="actions">
                  <span className="badge">{finding.severity}</span>
                  <span className="badge">Confidence {finding.confidence}</span>
                </div>
                <strong>{finding.title}</strong>
                <p>{finding.explanation}</p>
              </li>
            ))}
            {(risk.findings ?? []).length === 0 ? <li>No active findings.</li> : null}
          </ul>
        )}
      </section>
      <CommentaryPanel address={data.address} />
      <section className="panel">
        <h2>Top indexed holders</h2>
        {holders.ok ? (
          holders.data.holders.map((holder) => (
            <div className="metric-row" key={holder.address}>
              <Link href={`/wallet/${holder.address}`}>{compactAddress(holder.address)}</Link>
              <span>
                {formatRaw(holder.balanceRaw, data.decimals)} {data.symbol ?? ''}
                {holder.supplyShareBps === null ? '' : ` · ${Number(holder.supplyShareBps) / 100}%`}
              </span>
            </div>
          ))
        ) : (
          <Unavailable label="Holder projection" />
        )}
      </section>
      <ReportForm address={data.address} />
    </Page>
  );
}
