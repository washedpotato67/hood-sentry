import Link from 'next/link';
import { apiRequest, chainId } from '../lib/api';
import { ErrorPanel, Page, Stat } from './components';
import { type DiscoveryItem, DiscoveryTable } from './discovery-table';

type Feed = { organic: { data: readonly DiscoveryItem[] } };

export default async function Home() {
  const chain = chainId();
  const [trending, newTokens, health] = await Promise.all([
    apiRequest<Feed>(`/v1/discovery/trending?chainId=${chain}&limit=8`),
    apiRequest<Feed>(`/v1/discovery/newTokens?chainId=${chain}&limit=8`),
    apiRequest<{ status: string; checks?: Record<string, { status: string }> }>('/health/ready'),
  ]);
  const trendingItems = trending.ok ? trending.data.organic.data : [];
  const newItems = newTokens.ok ? newTokens.data.organic.data : [];
  return (
    <Page title="Know the risk before you sign">
      <div className="hero">
        <div className="eyebrow">Robinhood Chain intelligence</div>
        <p className="lede">
          Inspect token contracts, liquidity, holders, wallets, approvals, projects, and live risk
          evidence from one research terminal.
        </p>
        <div className="actions">
          <Link className="primary" href="/discover">
            Open discovery
          </Link>
          <Link href="/trade">Review a trade</Link>
        </div>
      </div>
      <div className="grid">
        <Stat label="Trending tokens" value={trendingItems.length.toString()} />
        <Stat label="New tokens" value={newItems.length.toString()} />
        <Stat label="API readiness" value={health.ok ? health.data.status : 'Degraded'} />
        <Stat label="Chain ID" value={chain.toString()} />
      </div>
      {trending.ok ? (
        <section className="panel">
          <h2>Trending now</h2>
          <DiscoveryTable items={trendingItems} />
        </section>
      ) : (
        <ErrorPanel code={trending.code} message={trending.message} />
      )}
    </Page>
  );
}
