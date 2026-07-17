'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiRequest, compactAddress } from '../../lib/api';
import { useSession } from '../use-session';

type Watchlist = {
  id: string;
  name: string;
  isDefault: boolean;
  items: readonly {
    id: string;
    targetAddress: string;
    targetType: 'token' | 'wallet' | 'contract' | 'project';
    notes: string | null;
  }[];
};

export function WatchlistList() {
  const { session } = useSession();
  const [lists, setLists] = useState<readonly Watchlist[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const result = await apiRequest<readonly Watchlist[]>('/v1/watchlists');
    if (result.ok) setLists(result.data);
    else setError(result.message);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (session?.authenticated) void load();
  }, [session, load]);

  if (session === null) return <p className="muted">Loading session…</p>;
  if (!session.authenticated)
    return <p className="unavailable">Connect your wallet to see your watchlists.</p>;
  if (error !== null) return <p className="danger">{error}</p>;
  if (!loaded) return <p className="muted">Loading watchlists…</p>;

  if (lists.length === 0) {
    return (
      <section className="panel">
        <h2>No watchlists yet</h2>
        <p className="muted">
          Group the tokens and wallets you track into a list, then attach alert rules to them.
        </p>
        <div className="actions">
          <Link className="primary" href="/watchlists/settings">
            Create a watchlist
          </Link>
        </div>
      </section>
    );
  }

  return (
    <div className="stack">
      {lists.map((list) => (
        <section className="panel" key={list.id}>
          <h2>
            {list.name} {list.isDefault ? <span className="badge">Default</span> : null}
          </h2>
          {list.items.length === 0 ? (
            <p className="muted">No targets yet. Add one from settings.</p>
          ) : null}
          {list.items.map((item) => (
            <div className="metric-row" key={item.id}>
              <Link
                href={`/${item.targetType === 'wallet' ? 'wallet' : 'token'}/${item.targetAddress}`}
              >
                {compactAddress(item.targetAddress)}
              </Link>
              <span className="badge">{item.targetType}</span>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
