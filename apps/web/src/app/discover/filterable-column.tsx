'use client';

import { useId, useMemo, useState } from 'react';
import { EmptyState } from '../components';
import { type DiscoveryItem, DiscoveryRow } from '../discovery-table';

// Filter chips for a board column. Each chip is an independent toggle; active
// chips combine with AND. Every rule is real feed data:
//   Safe     — the token's scan has no high-severity findings
//   $10K+/$100K+ — liquidity at or above the dollar threshold
//   <24h     — first seen on chain within the last day
//   Gainers  — liquidity growing since the last snapshot
type FilterKey = 'safe' | 'liq10k' | 'liq100k' | 'age24h' | 'gainer';

const FILTERS: readonly { key: FilterKey; label: string; title: string }[] = [
  { key: 'safe', label: 'Safe', title: 'No high-severity scan findings' },
  { key: 'liq10k', label: '$10K+', title: 'Liquidity of $10,000 or more' },
  { key: 'liq100k', label: '$100K+', title: 'Liquidity of $100,000 or more' },
  { key: 'age24h', label: '<24h', title: 'First listed within the last 24 hours' },
  { key: 'gainer', label: 'Gainers', title: 'Liquidity is growing' },
];

function meetsLiquidity(item: DiscoveryItem, dollars: bigint): boolean {
  if (item.liquidityRaw === null) return false;
  const decimals = item.liquidityDecimals ?? 18;
  return BigInt(item.liquidityRaw) >= dollars * 10n ** BigInt(decimals);
}

function matches(item: DiscoveryItem, key: FilterKey, nowMs: number): boolean {
  switch (key) {
    case 'safe':
      // Absent signals means no scan to judge on — that is not "safe".
      return item.signals !== undefined && item.signals.high === 0;
    case 'liq10k':
      return meetsLiquidity(item, 10_000n);
    case 'liq100k':
      return meetsLiquidity(item, 100_000n);
    case 'age24h': {
      if (item.firstSeenAt === null) return false;
      const ageMs = nowMs - Date.parse(item.firstSeenAt);
      return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 24 * 60 * 60 * 1000;
    }
    case 'gainer':
      return item.liquidityChangeBps !== null && BigInt(item.liquidityChangeBps) > 0n;
  }
}

/**
 * A board column whose list is filtered client-side by the chip bar. The server
 * hands it a `now` reference timestamp so the <24h rule ages consistently with
 * the page's own "Updated" readout.
 *
 * The column also folds shut. That is a phone-only affordance: below the
 * stacking breakpoint the three columns become one tall scroll, so the header
 * doubles as a disclosure control. `defaultCollapsed` seeds the state, and the
 * stylesheet only acts on `data-collapsed` inside the mobile media query, so
 * the desktop board is untouched no matter what this state holds.
 */
export function FilterableColumn({
  title,
  items,
  now,
  tone,
  defaultCollapsed = false,
}: {
  title: string;
  items: readonly DiscoveryItem[];
  now: string;
  tone: 'new' | 'trending' | 'volume';
  defaultCollapsed?: boolean;
}) {
  const [active, setActive] = useState<ReadonlySet<FilterKey>>(() => new Set());
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const bodyId = useId();
  const referenceMs = Date.parse(now);
  // Scans are attached by best-effort enrichment. Until at least one token in
  // the column has one, the Safe chip would always match nothing, so it is
  // hidden rather than left as a dead toggle.
  const anySignals = items.some((item) => item.signals !== undefined);

  function toggle(key: FilterKey) {
    setActive((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const filtered = useMemo(() => {
    if (active.size === 0) return items;
    const keys = [...active];
    return items.filter((item) => keys.every((key) => matches(item, key, referenceMs)));
  }, [items, active, referenceMs]);

  return (
    // Named so the column is exposed as a region: an unnamed <section> is not
    // a landmark, so the three feeds were indistinguishable when navigating by
    // region.
    <section
      className={`board-col tone-${tone}`}
      data-collapsed={collapsed}
      aria-labelledby={`${bodyId}-title`}
    >
      <header className="board-col-head">
        <span className="live-dot" aria-hidden="true" />
        <span className="board-col-title" id={`${bodyId}-title`}>
          {title}
        </span>
        <span className="board-col-count">{filtered.length}</span>
        {/* Hidden outright above the stacking breakpoint. `display: none` also
            drops it from the accessibility tree, so desktop never announces a
            control that would do nothing there. */}
        <button
          type="button"
          className="board-col-toggle"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => setCollapsed((value) => !value)}
        >
          <span className="board-col-toggle-label">
            {collapsed ? `Expand ${title}` : `Collapse ${title}`}
          </span>
          <svg
            className="board-col-chevron"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M6 9l6 6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </header>
      {/* Two wrappers so the fold animates on grid-template-rows (0fr↔1fr)
          rather than a guessed max-height: the outer is the grid, the inner is
          its single clipping row. Both are `display: contents` on desktop. */}
      <div className="board-col-body" id={bodyId}>
        <div className="board-col-fold">
          <fieldset className="board-filters" aria-label={`${title} filters`}>
            {FILTERS.filter(({ key }) => key !== 'safe' || anySignals).map(
              ({ key, label, title }) => (
                <button
                  key={key}
                  type="button"
                  className="filter-chip"
                  aria-pressed={active.has(key)}
                  title={title}
                  onClick={() => toggle(key)}
                >
                  {label}
                </button>
              ),
            )}
          </fieldset>
          <div className="board-list scroll-slim">
            {filtered.length === 0 ? (
              active.size === 0 ? (
                <EmptyState title="Still warming up">
                  Tokens appear here the moment their on-chain evidence is indexed. The board fills
                  as the indexer catches up.
                </EmptyState>
              ) : (
                <p className="filter-empty">No tokens match those filters. Try relaxing one.</p>
              )
            ) : (
              filtered.map((item) => <DiscoveryRow key={item.address} item={item} />)
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
