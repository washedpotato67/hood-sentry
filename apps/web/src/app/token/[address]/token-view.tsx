'use client';

import Link from 'next/link';
import { type ApiResult, apiRequest, chainId, compactAddress, formatRaw } from '../../../lib/api';
import { useLivePoll } from '../../../lib/use-live';
import { AiReportPanel } from './ai-report-panel';
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
  scoreStatus?: string;
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
  primaryPoolAddress: string | null;
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

/**
 * Machine reasons are for logs and clients, not for readers. Rendering the raw
 * code told visitors "NO_COMPLETED_SCAN: unavailable", which states a fact about
 * our pipeline rather than about the token they asked about.
 */
function describeRiskUnavailable(reason: string | null | undefined): string {
  switch (reason) {
    case 'NO_COMPLETED_SCAN':
      return 'No scan has completed yet. Scans run as the token’s on-chain evidence is indexed.';
    case 'WITHHELD_PENDING_RULE_COVERAGE':
      return 'The report is withheld until rule coverage is complete. A score cannot imply checks that did not run.';
    default:
      return 'The risk report is unavailable for this token.';
  }
}

/**
 * The token detail page rendered from the initial server fetch plus a
 * background poll, so price, pool counts, the risk report, and holders refresh
 * in place without a reload. A fresh page render replaces stale data
 * wholesale — there is no order to preserve.
 */
export function TokenView({
  initialToken,
  initialHolders,
  initialPrice,
}: {
  initialToken: TokenData;
  initialHolders: ApiResult<HolderData>;
  initialPrice: ApiResult<PriceData>;
}) {
  const chain = chainId();
  const tokenBase = `/v1/tokens/${encodeURIComponent(initialToken.address)}`;
  const { data: token } = useLivePoll({
    fetch: () => apiRequest<TokenData>(`${tokenBase}?chainId=${chain}`),
    initial: initialToken,
  });
  const { data: holders } = useLivePoll<ApiResult<HolderData>, HolderData>({
    fetch: () => apiRequest<HolderData>(`${tokenBase}/holders?chainId=${chain}&limit=20`),
    initial: initialHolders,
    merge: (_current, fresh) => ({ ok: true as const, data: fresh }),
  });
  const { data: price } = useLivePoll<ApiResult<PriceData>, PriceData>({
    fetch: () =>
      chain === 4663
        ? apiRequest<PriceData>(`${tokenBase}/price?chainId=${chain}&quoteAssetAddress=${USDG}`)
        : Promise.resolve({
            ok: false as const,
            status: 503,
            code: 'PRICE_SOURCE_UNAVAILABLE',
            message: 'No verified testnet quote asset is configured.',
          }),
    initial: initialPrice,
    merge: (_current, fresh) => ({ ok: true as const, data: fresh }),
  });

  const risk = token.risk;
  const score = risk.score ?? null;
  const priceValue = price.ok ? formatRaw(price.data.priceRaw, price.data.priceDecimals) : '·';
  const name = token.symbol ?? token.name ?? 'Token';
  return (
    <>
      <header className="page-head">
        <div>
          <Link className="back-link" href="/discover">
            ← Discover
          </Link>
          <h1>{name}</h1>
          <p className="token-address">
            <code>{token.address}</code>
          </p>
        </div>
        <div className="token-actions">
          <a
            className="primary"
            href={`https://www.geckoterminal.com/robinhood/pools/${token.primaryPoolAddress ?? token.address}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            Trade
          </a>
        </div>
      </header>

      <div className="token-facts">
        <div className="token-fact">
          <span className="token-fact-label">Price</span>
          <span className="token-fact-value">{priceValue}</span>
        </div>
        <div className="token-fact">
          <span className="token-fact-label">Pools</span>
          <span className="token-fact-value">{token.poolCount.toString()}</span>
        </div>
        <div className="token-fact">
          <span className="token-fact-label">Contract</span>
          <span className="token-fact-value">
            {token.contract?.verified ? 'Verified' : 'Unverified'}
          </span>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Risk report</h2>
          {score === null ? null : (
            <span className="risk-grade">
              <b>{score.grade}</b>
              <span className="risk-grade-meta">{score.completenessPercent}% covered</span>
            </span>
          )}
        </div>
        {risk.scoreStatus === 'WITHHELD_PENDING_RULE_COVERAGE' ? (
          <p className="muted">
            No single score. A number hides which check actually failed. Each signal below is a
            concrete, evidence-backed fact from live on-chain data, so you can see exactly what’s
            flagged and decide for yourself.
          </p>
        ) : null}
        {risk.status === 'unavailable' ? (
          <p className="muted">{describeRiskUnavailable(risk.reason)}</p>
        ) : (
          <ul className="risk-list">
            {(risk.findings ?? []).map((finding) => (
              <li className="risk-item" key={finding.id}>
                <div className="risk-item-head">
                  <span className={`badge sev-${finding.severity.toLowerCase()}`}>
                    {finding.severity}
                  </span>
                  <strong>{finding.title}</strong>
                </div>
                <p>{finding.explanation}</p>
                <span className="risk-item-meta">Confidence {finding.confidence}</span>
              </li>
            ))}
            {(risk.findings ?? []).length === 0 ? (
              <li className="risk-item">No active findings.</li>
            ) : null}
          </ul>
        )}
      </section>

      <AiReportPanel address={token.address} />

      <section className="panel">
        <div className="panel-head">
          <h2>Top holders</h2>
          {holders.ok ? (
            <span className="risk-grade-meta">{holders.data.holders.length} indexed</span>
          ) : null}
        </div>
        {holders.ok ? (
          <div className="holder-list">
            {holders.data.holders.map((holder, index) => (
              <div className="holder-row" key={holder.address}>
                <Link href={`/wallet/${holder.address}`}>
                  <span className="holder-rank">{index + 1}</span>
                  <code>{compactAddress(holder.address)}</code>
                </Link>
                <span>
                  {holder.supplyShareBps === null ? '·' : `${Number(holder.supplyShareBps) / 100}%`}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Holder projection is unavailable for this token.</p>
        )}
      </section>

      <ReportForm address={token.address} />
    </>
  );
}
