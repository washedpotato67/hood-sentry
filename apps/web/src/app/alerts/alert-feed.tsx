'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiRequest, compactAddress } from '../../lib/api';
import { useSession } from '../use-session';

type AlertEvent = {
  id: string;
  alertRuleId: string;
  blockNumber: string;
  transactionHash: string | null;
  triggeredAt: string;
  severity: string;
};

export function AlertFeed() {
  const { session } = useSession();
  const [events, setEvents] = useState<readonly AlertEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const result = await apiRequest<readonly AlertEvent[]>('/v1/alert-events?limit=50');
    if (result.ok) setEvents(result.data);
    else setError(result.message);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (session?.authenticated) void load();
  }, [session, load]);

  if (session === null) return <p className="muted">Loading session…</p>;
  if (!session.authenticated)
    return <p className="unavailable">Connect your wallet to see your alerts.</p>;
  if (error !== null) return <p className="danger">{error}</p>;
  if (!loaded) return <p className="muted">Loading evidence alerts…</p>;

  if (events.length === 0) {
    return (
      <section className="panel">
        <h2>No evidence alerts yet</h2>
        <p className="muted">
          Alerts appear here the moment a rule matches indexed chain evidence. Nothing has fired
          yet.
        </p>
        <div className="actions">
          <Link className="primary" href="/alerts/settings">
            Create an alert rule
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Recent evidence alerts</h2>
      {events.map((event) => (
        <div className="metric-row" key={event.id}>
          <span>
            <strong>{event.severity}</strong> at block {event.blockNumber}
            <br />
            <small className="muted">{new Date(event.triggeredAt).toLocaleString()}</small>
          </span>
          <code>
            {event.transactionHash === null
              ? 'No transaction'
              : compactAddress(event.transactionHash)}
          </code>
        </div>
      ))}
    </section>
  );
}
