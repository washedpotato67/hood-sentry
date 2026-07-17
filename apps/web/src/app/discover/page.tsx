import { apiRequest, chainId } from '../../lib/api';
import { ErrorPanel, Page, Stat } from '../components';
import { type DiscoveryItem, DiscoveryTable } from '../discovery-table';

type Feed = {
  organic: { data: readonly DiscoveryItem[] };
  sponsored: { data: readonly unknown[] };
};
type Search = { data: readonly { item: DiscoveryItem }[] };

// The API feed keys double as URL params, so they stay camelCase on the wire.
// These are the human labels shown wherever a key would otherwise surface.
const FEEDS = [
  { value: 'trending', label: 'Trending' },
  { value: 'newTokens', label: 'New tokens' },
  { value: 'newPools', label: 'New pools' },
  { value: 'volumeGainers', label: 'Volume gainers' },
  { value: 'liquidityGainers', label: 'Liquidity gainers' },
  { value: 'recentlyMigrated', label: 'Recently migrated' },
  { value: 'recentCriticalRisk', label: 'Critical risk' },
] as const;

export default async function Discover({
  searchParams,
}: {
  searchParams: Promise<{ query?: string; feed?: string }>;
}) {
  const query = await searchParams;
  const chain = chainId();
  const feeds = new Set<string>(FEEDS.map((entry) => entry.value));
  const feed = query.feed !== undefined && feeds.has(query.feed) ? query.feed : 'trending';
  const feedLabel = FEEDS.find((entry) => entry.value === feed)?.label ?? feed;
  let items: readonly DiscoveryItem[] = [];
  let error: { code: string; message: string } | null = null;
  if (query.query !== undefined && query.query.length > 0) {
    const result = await apiRequest<Search>(
      `/v1/search?chainId=${chain}&limit=50&query=${encodeURIComponent(query.query)}`,
    );
    if (result.ok) items = result.data.data.map((entry) => entry.item);
    else error = result;
  } else {
    const result = await apiRequest<Feed>(`/v1/discovery/${feed}?chainId=${chain}&limit=50`);
    if (result.ok) items = result.data.organic.data;
    else error = result;
  }
  return (
    <Page title="Discover">
      <p className="lede">
        Organic rankings keep score components, confidence, and warnings visible.
      </p>
      <div className="grid">
        <Stat label="View" value={query.query ? `Search: ${query.query}` : feedLabel} />
        <Stat label="Results" value={items.length.toString()} />
        <Stat label="Chain ID" value={chain.toString()} />
      </div>
      {error === null ? (
        <section className="panel">
          <div className="actions">
            {FEEDS.map((entry) => (
              <a
                className={entry.value === feed ? 'badge status-ready' : 'badge'}
                href={`?feed=${entry.value}`}
                key={entry.value}
              >
                {entry.label}
              </a>
            ))}
          </div>
          <DiscoveryTable items={items} />
        </section>
      ) : (
        <ErrorPanel code={error.code} message={error.message} />
      )}
    </Page>
  );
}
