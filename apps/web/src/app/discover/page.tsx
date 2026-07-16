import { apiRequest, chainId } from '../../lib/api';
import { ErrorPanel, Page, Stat } from '../components';
import { type DiscoveryItem, DiscoveryTable } from '../discovery-table';

type Feed = {
  organic: { data: readonly DiscoveryItem[] };
  sponsored: { data: readonly unknown[] };
};
type Search = { data: readonly { item: DiscoveryItem }[] };

export default async function Discover({
  searchParams,
}: {
  searchParams: Promise<{ query?: string; feed?: string }>;
}) {
  const query = await searchParams;
  const chain = chainId();
  const feeds = new Set([
    'newTokens',
    'newPools',
    'trending',
    'volumeGainers',
    'liquidityGainers',
    'recentlyMigrated',
    'recentCriticalRisk',
  ]);
  const feed = query.feed !== undefined && feeds.has(query.feed) ? query.feed : 'trending';
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
        <Stat label="View" value={query.query ? `Search: ${query.query}` : feed} />
        <Stat label="Results" value={items.length.toString()} />
        <Stat label="Chain ID" value={chain.toString()} />
      </div>
      {error === null ? (
        <section className="panel">
          <div className="actions">
            {Array.from(feeds).map((value) => (
              <a
                className={value === feed ? 'badge status-ready' : 'badge'}
                href={`?feed=${value}`}
                key={value}
              >
                {value}
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
