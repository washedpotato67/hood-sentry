import type { Metadata } from 'next';
import { type ApiResult, apiRequest, chainId } from '../../../lib/api';
import { ErrorPanel, Page } from '../../components';
import { TokenView } from './token-view';

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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}): Promise<Metadata> {
  const { address } = await params;
  const token = await apiRequest<TokenData>(
    `/v1/tokens/${encodeURIComponent(address)}?chainId=${chainId()}`,
  );
  const label = token.ok ? (token.data.symbol ?? token.data.name ?? null) : null;
  return { title: label ?? 'Token' };
}

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
      : Promise.resolve<ApiResult<PriceData>>({
          ok: false,
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
  return <TokenView initialToken={token.data} initialHolders={holders} initialPrice={price} />;
}
