'use client';

import { apiRequest, chainId } from '../../lib/api';
import { enrichWithSignals } from '../../lib/enrich';
import { mergeRanked, useLivePoll } from '../../lib/use-live';
import type { DiscoveryItem } from '../discovery-table';
import { FilterableColumn } from './filterable-column';

const MAX_ITEMS = 100;

type Column = {
  title: string;
  feed: string;
  items: readonly DiscoveryItem[];
  tone: 'new' | 'trending' | 'volume';
};

async function pollFeed(chain: number, feed: string) {
  const result = await apiRequest<{ organic: { data: readonly DiscoveryItem[] } }>(
    `/v1/discovery/${feed}?chainId=${chain}&limit=${MAX_ITEMS}`,
  );
  if (!result.ok) return result;
  return {
    ok: true as const,
    data: await enrichWithSignals(chain, result.data.organic.data),
  };
}

function LiveColumn({
  column,
  nowIso,
  defaultCollapsed,
}: {
  column: Column;
  nowIso: string;
  defaultCollapsed: boolean;
}) {
  const chain = chainId();
  const { data, updatedAt } = useLivePoll({
    fetch: () => pollFeed(chain, column.feed),
    initial: column.items,
    merge: (current, fresh) =>
      mergeRanked(current, fresh, (item) => item.address.toLowerCase(), MAX_ITEMS),
  });
  // The <24h filter ages against the latest successful poll, not the page load.
  return (
    <FilterableColumn
      title={column.title}
      items={data}
      now={updatedAt ?? nowIso}
      tone={column.tone}
      defaultCollapsed={defaultCollapsed}
    />
  );
}

/**
 * The board columns re-rendered from the server plus a background poll that
 * streams fresh rankings in without a page refresh. Each column refreshes
 * independently: new tokens prepend in ranked order, listed rows update their
 * metrics in place (no reshuffle under the cursor), and rows that rank out of
 * the feed are dropped.
 *
 * On phones the columns stack, so only the leading one starts open; the rest
 * fold to their headers and the whole board fits on a screen instead of running
 * three feeds deep. Above the stacking breakpoint the collapse state is inert.
 */
export function LiveBoard({ initial, nowIso }: { initial: readonly Column[]; nowIso: string }) {
  return (
    <div className="board">
      {initial.map((column, index) => (
        <LiveColumn
          key={column.feed}
          column={column}
          nowIso={nowIso}
          defaultCollapsed={index > 0}
        />
      ))}
    </div>
  );
}
