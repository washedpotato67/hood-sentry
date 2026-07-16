'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiDelete, apiRequest } from '../../lib/api';
import { useSession } from '../use-session';

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: readonly string[];
  quotaPerMinute: number;
  quotaPerDay: number;
  revokedAt: string | null;
};

type IssuedKey = ApiKey & { token: string };

export function ApiKeyDashboard() {
  const { session } = useSession();
  const [keys, setKeys] = useState<readonly ApiKey[]>([]);
  const [name, setName] = useState('Research terminal');
  const [issued, setIssued] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await apiRequest<readonly ApiKey[]>('/v1/api-keys');
    if (result.ok) setKeys(result.data);
    else setError(result.message);
  }, []);
  useEffect(() => {
    if (session?.authenticated) void load();
  }, [session, load]);

  async function issue() {
    setBusy(true);
    setIssued(null);
    const result = await apiRequest<IssuedKey>('/v1/api-keys', {
      method: 'POST',
      body: JSON.stringify({
        name,
        scopes: ['tokens:read', 'risk:read', 'wallets:read'],
      }),
    });
    setBusy(false);
    if (result.ok) {
      setIssued(result.data.token);
      await load();
    } else setError(result.message);
  }

  async function revoke(id: string) {
    setBusy(true);
    const result = await apiDelete(`/v1/api-keys/${id}`);
    setBusy(false);
    if (result.ok) await load();
    else setError(result.message);
  }

  if (session === null) return <p className="muted">Loading session…</p>;
  if (!session.authenticated)
    return <p className="unavailable">Connect your wallet to issue API keys.</p>;
  return (
    <div className="stack">
      <section className="panel">
        <h2>Issue API key</h2>
        <div className="form-grid">
          <label className="field">
            Key name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
        </div>
        <div className="actions">
          <button
            className="primary"
            type="button"
            onClick={issue}
            disabled={busy || name.trim().length === 0}
          >
            Issue key
          </button>
        </div>
        {issued === null ? null : (
          <div className="result-box">
            <p className="warning">Copy this key now. Sentry stores no recoverable copy.</p>
            <code>{issued}</code>
          </div>
        )}
      </section>
      <section className="panel">
        <h2>Keys</h2>
        {keys.length === 0 ? <p className="muted">No API keys.</p> : null}
        {keys.map((key) => (
          <div className="metric-row" key={key.id}>
            <span>
              <strong>{key.name}</strong>
              <br />
              <code>{key.prefix}</code>
              <br />
              <small className="muted">{key.scopes.join(', ')}</small>
            </span>
            <span className="actions">
              <span className="badge">{key.quotaPerMinute}/min</span>
              <button
                type="button"
                onClick={() => revoke(key.id)}
                disabled={busy || key.revokedAt !== null}
              >
                Revoke
              </button>
            </span>
          </div>
        ))}
      </section>
      {error === null ? null : <section className="panel danger">{error}</section>}
    </div>
  );
}
