import Link from 'next/link';
import { apiRequest, chainId, formatCompactUsd } from '../lib/api';
import { enrichWithSignals } from '../lib/enrich';
import { ErrorPanel, Stat } from './components';
import { type DiscoveryItem, DiscoveryTable } from './discovery-table';

type Feed = { organic: { data: readonly DiscoveryItem[] } };

const DOMAINS = [
  {
    n: '01',
    title: 'Contract control',
    body: 'Ownership, proxy upgradeability, and privileged functions that can rewrite the rules after you buy.',
  },
  {
    n: '02',
    title: 'Liquidity',
    body: 'Pool depth, lock status, and thin-pool exposure: how easily the floor can be pulled.',
  },
  {
    n: '03',
    title: 'Holder distribution',
    body: 'Concentration and insider clusters that can dump into your exit.',
  },
  {
    n: '04',
    title: 'Oracle behavior',
    body: 'Stale, paused, or sequencer-down price feeds that make on-chain prices unreliable.',
  },
  {
    n: '05',
    title: 'Market integrity',
    body: 'Wash trading, wallet collusion, and single-transaction price manipulation in the trade record.',
  },
  {
    n: '06',
    title: 'Wallets & approvals',
    body: 'The allowances and counterparties a signature actually exposes before you sign it.',
  },
] as const;

export default async function Home() {
  const chain = chainId();
  const [trending, newTokens] = await Promise.all([
    apiRequest<Feed>(`/v1/discovery/trending?chainId=${chain}&limit=8`),
    apiRequest<Feed>(`/v1/discovery/newTokens?chainId=${chain}&limit=8`),
  ]);
  const [trendingItems, newItems] = await Promise.all([
    trending.ok
      ? enrichWithSignals(chain, trending.data.organic.data)
      : Promise.resolve<readonly DiscoveryItem[]>([]),
    newTokens.ok
      ? enrichWithSignals(chain, newTokens.data.organic.data)
      : Promise.resolve<readonly DiscoveryItem[]>([]),
  ]);
  // 24h volume across the trending set: a live signal of chain activity, and a
  // more meaningful headline than internal API health. Volumes are raw integers
  // at 18 decimals.
  const volume24h = trendingItems.reduce(
    (sum, item) => sum + (item.volumeRaw ? Number(item.volumeRaw) / 1e18 : 0),
    0,
  );
  return (
    <>
      <header className="hero">
        <div className="hero-grid">
          <div className="hero-copy reveal reveal-1">
            <h1>
              Know the risk <mark>before you sign.</mark>
            </h1>
            <p className="lede">
              Sentry inspects token contracts, liquidity, holders, oracles, and the live trade
              record on Robinhood Chain, then shows you the evidence behind every verdict, not a
              black-box score.
            </p>
            <div className="actions">
              <Link className="primary" href="/discover">
                Open discovery →
              </Link>
              <Link href="/methodology">How it works</Link>
            </div>
          </div>
        </div>
      </header>

      <div className="grid reveal reveal-3">
        <Stat label="Trending tokens" value={trendingItems.length.toString()} />
        <Stat label="New tokens" value={newItems.length.toString()} />
        <Stat label="24h volume" value={formatCompactUsd(volume24h)} />
        <Stat label="Chain ID" value={chain.toString()} />
      </div>

      <section>
        <div className="section-head">
          <h2>What every scan examines</h2>
        </div>
        <div className="pillars">
          {DOMAINS.map((d) => (
            <article className="pillar" key={d.n}>
              <div className="pillar-idx">{d.n}</div>
              <h3>{d.title}</h3>
              <p>{d.body}</p>
            </article>
          ))}
        </div>
      </section>

      {trending.ok ? (
        <section className="panel">
          <h2>Trending now</h2>
          <DiscoveryTable items={trendingItems} />
        </section>
      ) : (
        <ErrorPanel code={trending.code} message={trending.message} />
      )}
    </>
  );
}
