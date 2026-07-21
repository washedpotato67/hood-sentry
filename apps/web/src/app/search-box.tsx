'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest, chainId, compactAddress } from '../lib/api';

type SearchResult = {
  address: string;
  symbol: string | null;
  name: string | null;
  priceUsd: string | null;
  liquidityUsd: string | null;
  volume24hUsd: string | null;
};

const HISTORY_KEY = 'sentry.search.history';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function readHistory(): SearchResult[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const parsed = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SearchResult[]).slice(0, 6) : [];
  } catch {
    return [];
  }
}

function pushHistory(entry: SearchResult): void {
  if (typeof window === 'undefined') return;
  const next = [entry, ...readHistory().filter((e) => e.address !== entry.address)].slice(0, 6);
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // A full or disabled storage is not worth failing navigation over.
  }
}

/** A compact USD figure: $1.2M, $12.3K, $0.0000312. */
function usd(value: string | null): string {
  if (value === null) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n === 0) return '$0';
  return `$${n.toPrecision(3)}`;
}

/**
 * A command-palette search: click the field or press cmd/ctrl-K or "/" to open a
 * modal that searches every token on the chain by name, symbol, or address, with
 * recent history and full keyboard navigation. A bare address opens its page
 * directly.
 */
export function SearchBox() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [history, setHistory] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const shown = query.trim().length === 0 ? history : results;

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setResults([]);
    setActive(0);
  }, []);

  const go = useCallback(
    (entry: SearchResult) => {
      pushHistory(entry);
      close();
      router.push(`/token/${entry.address}`);
    },
    [close, router],
  );

  // Global shortcuts: cmd/ctrl-K and "/" open the palette; the "/" is ignored
  // while typing in another field so it does not hijack ordinary input.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const typing =
        event.target instanceof HTMLElement &&
        ['input', 'textarea'].includes(event.target.tagName.toLowerCase());
      if ((key === 'k' && (event.metaKey || event.ctrlKey)) || (key === '/' && !typing)) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setHistory(readHistory());
    const id = window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => window.clearTimeout(id);
  }, [open]);

  // Debounced search. A bare address is offered as a direct hit without a call.
  useEffect(() => {
    const value = query.trim();
    if (value.length === 0) {
      setResults([]);
      return;
    }
    if (ADDRESS.test(value)) {
      setResults([
        {
          address: value,
          symbol: null,
          name: 'Open token page',
          priceUsd: null,
          liquidityUsd: null,
          volume24hUsd: null,
        },
      ]);
      return;
    }
    setLoading(true);
    const handle = window.setTimeout(async () => {
      const res = await apiRequest<SearchResult[]>(
        `/v1/search/tokens?chainId=${chainId()}&q=${encodeURIComponent(value)}&limit=8`,
      );
      setResults(res.ok ? res.data : []);
      setActive(0);
      setLoading(false);
    }, 180);
    return () => window.clearTimeout(handle);
  }, [query]);

  const onListKey = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(shown.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const entry = shown[active];
      if (entry !== undefined) go(entry);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  return (
    <>
      <button
        type="button"
        className="search search-trigger"
        onClick={() => setOpen(true)}
        aria-label="Search tokens"
      >
        <span className="search-trigger-label">
          <svg
            className="search-ico"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="M20 20l-3.6-3.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="muted">Search tokens…</span>
        </span>
        <kbd className="kbd">⌘K</kbd>
      </button>

      {open ? (
        // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is a dismissal affordance, keyboard handled by Escape inside.
        <div className="cmd-backdrop" onClick={close}>
          {/* biome-ignore lint/a11y/useSemanticElements: an anchored command-palette overlay, not a native <dialog> modal flow. */}
          <div
            className="cmd-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Token search"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onListKey}
          >
            <div className="cmd-input-row">
              <input
                ref={inputRef}
                className="cmd-input"
                placeholder="Search by name, symbol, or address…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd className="kbd">Esc</kbd>
            </div>

            <div className="cmd-list">
              {query.trim().length === 0 && history.length > 0 ? (
                <div className="cmd-section">Recent</div>
              ) : null}
              {loading && shown.length === 0 ? <div className="cmd-empty">Searching…</div> : null}
              {!loading && query.trim().length > 0 && shown.length === 0 ? (
                <div className="cmd-empty">No tokens found.</div>
              ) : null}
              {query.trim().length === 0 && history.length === 0 ? (
                <div className="cmd-empty">Search any token on the chain.</div>
              ) : null}

              {shown.map((entry, index) => (
                <button
                  type="button"
                  key={entry.address}
                  className={`cmd-row ${index === active ? 'is-active' : ''}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => go(entry)}
                >
                  <span className="cmd-token">
                    <strong>{entry.symbol ?? 'Token'}</strong>
                    <span className="muted cmd-name">
                      {entry.name ?? compactAddress(entry.address)}
                    </span>
                  </span>
                  <span className="cmd-metrics">
                    <span>{usd(entry.priceUsd)}</span>
                    <span className="muted">L {usd(entry.liquidityUsd)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
