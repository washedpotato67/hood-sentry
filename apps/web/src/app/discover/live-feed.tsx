'use client';

import Link from 'next/link';
import { apiRequest, chainId } from '../../lib/api';
import { enrichWithSignals } from '../../lib/enrich';
import { mergeRanked, useLivePoll } from '../../lib/use-live';
import { type DiscoveryItem, DiscoveryRow } from '../discovery-table';

const FEEDS = [
  { value: 'trending', label: 'Trending' },
  { value: 'newTokens', label: 'New tokens' },
  { value: 'newPools', label: 'New pools' },
  { value: 'volumeGainers', label: 'Volume gainers' },
  { value: 'liquidityGainers', label: 'Liquidity gainers' },
  { value: 'recentlyMigrated', label: 'Recently migrated' },
  { value: 'recentCriticalRisk', label: 'Critical risk' },
] as const;

type Feed = { organic: { data: readonly DiscoveryItem[] } };
type Search = { data: readonly { item: DiscoveryItem }[] };

/**
 * A single discovery feed as one full column, streaming fresh rankings in
 * without a reload: new entries prepend, listed rows update in place.
 */
export function LiveFeedResults({
  feed,
  items,
}: {
  feed: string;
  items: readonly DiscoveryItem[];
}) {
  const chain = chainId();
  const { data } = useLivePoll({
    fetch: async () => {
      const result = await apiRequest<Feed>(`/v1/discovery/${feed}?chainId=${chain}&limit=50`);
      if (!result.ok) return result;
      return { ok: true as const, data: await enrichWithSignals(chain, result.data.organic.data) };
    },
    initial: items,
    merge: (current, fresh) =>
      mergeRanked(current, fresh, (item) => item.address.toLowerCase(), 50),
  });

  return (
    <section className="panel">
      <div className="toggles" role="tablist" aria-label="Discovery feed">
        <Link className="toggle" href="/discover">
          ← All feeds
        </Link>
        {FEEDS.map((entry) => {
          const active = entry.value === feed;
          return (
            <Link
              className="toggle"
              aria-selected={active}
              role="tab"
              href={`?feed=${entry.value}`}
              key={entry.value}
            >
              {entry.label}
            </Link>
          );
        })}
      </div>
      <div className="board-list scroll-slim">
        {data.map((item) => (
          <DiscoveryRow key={item.address} item={item} />
        ))}
      </div>
    </section>
  );
}

/**
 * Search results, streamed the same way: the query re-runs in the background
 * and new matches prepend while already-shown rows keep their position.
 */
export function LiveSearchResults({
  query,
  items,
}: {
  query: string;
  items: readonly DiscoveryItem[];
}) {
  const chain = chainId();
  const { data } = useLivePoll({
    fetch: async () => {
      const result = await apiRequest<Search>(
        `/v1/search?chainId=${chain}&limit=50&query=${encodeURIComponent(query)}`,
      );
      if (!result.ok) return result;
      return {
        ok: true as const,
        data: await enrichWithSignals(
          chain,
          result.data.data.map((entry) => entry.item),
        ),
      };
    },
    initial: items,
    merge: (current, fresh) =>
      mergeRanked(current, fresh, (item) => item.address.toLowerCase(), 50),
  });

  return (
    <section className="panel">
      <h2>Search: {query}</h2>
      <div className="board-list scroll-slim">
        {data.map((item) => (
          <DiscoveryRow key={item.address} item={item} />
        ))}
      </div>
    </section>
  );
}
