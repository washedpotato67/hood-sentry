import { apiRequest, chainId } from '../../lib/api';
import { enrichWithSignals } from '../../lib/enrich';
import { ErrorPanel } from '../components';
import type { DiscoveryItem } from '../discovery-table';
import { LiveBoard } from './live-board';
import { LiveFeedResults, LiveSearchResults } from './live-feed';

type Feed = {
  organic: { data: readonly DiscoveryItem[] };
  sponsored: { data: readonly unknown[] };
};
type Search = { data: readonly { item: DiscoveryItem }[] };
type LoadError = { code: string; message: string };

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

// The board's three live columns — the terminal view. Each is its own feed.
// All three load up to 100 candidates so the filter bar (Safe, $10K+, $100K+,
// <24h, Gainers) has material to work with in every column.
const BOARD: readonly {
  title: string;
  feed: string;
  limit: number;
  tone: 'new' | 'trending' | 'volume';
}[] = [
  { title: 'New', feed: 'newTokens', limit: 100, tone: 'new' },
  { title: 'Trending', feed: 'trending', limit: 100, tone: 'trending' },
  { title: 'Top Volume', feed: 'volumeGainers', limit: 100, tone: 'volume' },
];

type BoardColumn = {
  title: string;
  feed: string;
  items: readonly DiscoveryItem[];
  tone: 'new' | 'trending' | 'volume';
};

// The page renders exactly one mode; the union keeps the fetch phase and the
// render phase decoupled so the render switch stays flat.
type Mode =
  | { kind: 'search'; query: string; items: readonly DiscoveryItem[]; error: LoadError | null }
  | { kind: 'feed'; feed: string; items: readonly DiscoveryItem[]; error: LoadError | null }
  | { kind: 'board'; board: readonly BoardColumn[] };

async function loadFeed(chain: number, feed: string, limit: number) {
  const result = await apiRequest<Feed>(`/v1/discovery/${feed}?chainId=${chain}&limit=${limit}`);
  if (!result.ok) return { items: [] as readonly DiscoveryItem[], error: result };
  return { items: await enrichWithSignals(chain, result.data.organic.data), error: null };
}

async function resolveMode(query: { query?: string; feed?: string }): Promise<Mode> {
  const chain = chainId();
  const feeds = new Set<string>(FEEDS.map((entry) => entry.value));

  // A ?feed= deep link renders that feed as one full board column; otherwise the
  // terminal three-column board (Trending / New / Top Volume) is the default.
  const soloFeed = query.feed !== undefined && feeds.has(query.feed) ? query.feed : null;

  if (query.query !== undefined && query.query.length > 0) {
    const result = await apiRequest<Search>(
      `/v1/search?chainId=${chain}&limit=50&query=${encodeURIComponent(query.query)}`,
    );
    if (result.ok) {
      const items = await enrichWithSignals(
        chain,
        result.data.data.map((entry) => entry.item),
      );
      return { kind: 'search', query: query.query, items, error: null };
    }
    return { kind: 'search', query: query.query, items: [], error: result };
  }
  if (soloFeed !== null) {
    const loaded = await loadFeed(chain, soloFeed, 50);
    return { kind: 'feed', feed: soloFeed, items: loaded.items, error: loaded.error };
  }
  const loaded = await Promise.all(
    BOARD.map(async (column) => loadFeed(chain, column.feed, column.limit)),
  );
  const board = BOARD.map((column, index) => ({
    ...column,
    items: loaded[index]?.items ?? [],
  }));
  return { kind: 'board', board };
}

function ModeView({ mode, nowIso }: { mode: Mode; nowIso: string }) {
  if (mode.kind === 'search') {
    return mode.error === null ? (
      <LiveSearchResults query={mode.query} items={mode.items} />
    ) : (
      <ErrorPanel code={mode.error.code} message={mode.error.message} />
    );
  }
  if (mode.kind === 'feed') {
    return mode.error === null ? (
      <LiveFeedResults feed={mode.feed} items={mode.items} />
    ) : (
      <ErrorPanel code={mode.error.code} message={mode.error.message} />
    );
  }
  return <LiveBoard initial={mode.board} nowIso={nowIso} />;
}

export default async function Discover({
  searchParams,
}: {
  searchParams: Promise<{ query?: string; feed?: string }>;
}) {
  const query = await searchParams;
  const mode = await resolveMode(query);
  const nowIso = new Date().toISOString();

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Discover</h1>
          <p className="lede">
            Fresh listings, momentum, and depth, straight off the chain, ranked by evidence.
          </p>
        </div>
      </header>
      <ModeView mode={mode} nowIso={nowIso} />
    </>
  );
}
