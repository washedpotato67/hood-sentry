'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiDelete, apiRequest } from '../../lib/api';

type Webhook = {
  id: string;
  url: string;
  events: readonly string[];
  enabled: boolean;
};

type SecretResponse = Webhook & { signingSecret: string };

export function WebhookDashboard() {
  const [webhooks, setWebhooks] = useState<readonly Webhook[]>([]);
  const [url, setUrl] = useState('');
  const [event, setEvent] = useState('alert.triggered');
  const [secret, setSecret] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await apiRequest<readonly Webhook[]>('/v1/webhooks');
    if (result.ok) setWebhooks(result.data);
    else if (result.code !== 'FEATURE_DISABLED') setMessage(result.message);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setMessage(null);
    const result = await apiRequest<SecretResponse>('/v1/webhooks', {
      method: 'POST',
      body: JSON.stringify({ url, events: [event], enabled: true }),
    });
    setBusy(false);
    if (result.ok) {
      setSecret(result.data.signingSecret);
      setUrl('');
      await load();
    } else setMessage(result.message);
  }

  async function rotate(id: string) {
    setBusy(true);
    const result = await apiRequest<{ signingSecret: string }>(`/v1/webhooks/${id}/rotate-secret`, {
      method: 'POST',
      body: '{}',
    });
    setBusy(false);
    if (result.ok) setSecret(result.data.signingSecret);
    else setMessage(result.message);
  }

  async function remove(id: string) {
    setBusy(true);
    const result = await apiDelete(`/v1/webhooks/${id}`);
    setBusy(false);
    if (result.ok) await load();
    else setMessage(result.message);
  }

  return (
    <section className="panel">
      <h2>Signed webhooks</h2>
      <p className="muted">Endpoints must use public HTTPS URLs.</p>
      <div className="form-grid">
        <label className="field">
          Endpoint URL
          <input value={url} type="url" onChange={(change) => setUrl(change.target.value)} />
        </label>
        <label className="field">
          Event
          <select value={event} onChange={(change) => setEvent(change.target.value)}>
            <option value="alert.triggered">Alert triggered</option>
            <option value="alert.resolved">Alert resolved</option>
            <option value="risk.changed">Risk changed</option>
            <option value="project.reported">Project reported</option>
            <option value="transaction.finalized">Transaction finalized</option>
          </select>
        </label>
      </div>
      <button type="button" onClick={create} disabled={busy || url.length === 0}>
        Create webhook
      </button>
      {secret === null ? null : (
        <div className="secret-panel">
          <strong>Save this signing secret now</strong>
          <code>{secret}</code>
        </div>
      )}
      {webhooks.map((webhook) => (
        <div className="metric-row" key={webhook.id}>
          <span>
            <code>{webhook.url}</code>
            <br />
            <small className="muted">{webhook.events.join(', ')}</small>
          </span>
          <span className="actions">
            <button type="button" onClick={() => rotate(webhook.id)} disabled={busy}>
              Rotate secret
            </button>
            <button type="button" onClick={() => remove(webhook.id)} disabled={busy}>
              Delete
            </button>
          </span>
        </div>
      ))}
      {message === null ? null : <p>{message}</p>}
    </section>
  );
}
