'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiRequest, chainId, compactAddress } from '../../lib/api';
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

export function WatchlistDashboard() {
  const { session } = useSession();
  const [lists, setLists] = useState<readonly Watchlist[]>([]);
  const [name, setName] = useState('Research');
  const [target, setTarget] = useState('');
  const [targetType, setTargetType] = useState<'token' | 'wallet'>('token');
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await apiRequest<readonly Watchlist[]>('/v1/watchlists');
    if (result.ok) {
      setLists(result.data);
      setSelected((current) => current || result.data[0]?.id || '');
    } else setError(result.message);
  }, []);

  useEffect(() => {
    if (session?.authenticated) void load();
  }, [session, load]);

  async function createList() {
    setBusy(true);
    const result = await apiRequest<Watchlist>('/v1/watchlists', {
      method: 'POST',
      body: JSON.stringify({ name, isDefault: lists.length === 0 }),
    });
    setBusy(false);
    if (result.ok) {
      setName('');
      await load();
    } else setError(result.message);
  }

  async function addItem() {
    if (selected.length === 0) return;
    setBusy(true);
    const result = await apiRequest(`/v1/watchlists/${selected}/items`, {
      method: 'POST',
      body: JSON.stringify({
        chainId: chainId(),
        targetAddress: target,
        targetType,
        notes: null,
      }),
    });
    setBusy(false);
    if (result.ok) {
      setTarget('');
      await load();
    } else setError(result.message);
  }

  if (session === null) return <p className="muted">Loading session…</p>;
  if (!session.authenticated)
    return <p className="unavailable">Connect your wallet to manage watchlists.</p>;
  return (
    <div className="stack">
      <section className="panel">
        <h2>Create watchlist</h2>
        <div className="form-grid">
          <label className="field">
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
        </div>
        <div className="actions">
          <button
            className="primary"
            type="button"
            onClick={createList}
            disabled={busy || name.trim().length === 0}
          >
            Create
          </button>
        </div>
      </section>
      <section className="panel">
        <h2>Add target</h2>
        {lists.length === 0 ? (
          <p className="muted">Create a watchlist first. Every target belongs to a list.</p>
        ) : null}
        <div className="form-grid">
          <label className="field">
            Watchlist
            <select
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              disabled={lists.length === 0}
            >
              {/* Without a placeholder the picker opens as an empty sliver and
                  reads as broken rather than as "nothing to choose yet". */}
              {lists.length === 0 ? <option value="">No watchlists yet</option> : null}
              {lists.map((list) => (
                <option value={list.id} key={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Type
            <select
              value={targetType}
              onChange={(event) =>
                setTargetType(event.target.value === 'wallet' ? 'wallet' : 'token')
              }
            >
              <option value="token">Token</option>
              <option value="wallet">Wallet</option>
            </select>
          </label>
          <label className="field">
            Address
            <input
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder="0x…"
            />
          </label>
        </div>
        <div className="actions">
          <button type="button" onClick={addItem} disabled={busy || selected.length === 0}>
            Add target
          </button>
        </div>
      </section>
      {lists.map((list) => (
        <section className="panel" key={list.id}>
          <h2>
            {list.name} {list.isDefault ? <span className="badge">Default</span> : null}
          </h2>
          {list.items.length === 0 ? <p className="muted">No targets.</p> : null}
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
      {error === null ? null : <section className="panel danger">{error}</section>}
    </div>
  );
}
