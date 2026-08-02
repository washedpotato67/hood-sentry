'use client';

import Link from 'next/link';
import { apiRequest, compactAddress } from '../../lib/api';
import { useLivePoll } from '../../lib/use-live';
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
  const {
    data: events,
    error,
    updatedAt,
  } = useLivePoll({
    fetch: () => apiRequest<readonly AlertEvent[]>('/v1/alert-events?limit=50'),
    initial: [] as readonly AlertEvent[],
    enabled: session?.authenticated === true,
  });

  if (session === null) return <p className="muted">Loading session…</p>;
  if (!session.authenticated)
    return <p className="unavailable">Connect your wallet to see your alerts.</p>;
  if (error !== null && events.length === 0) return <p className="danger">{error}</p>;
  if (updatedAt === null) return <p className="muted">Loading evidence alerts…</p>;

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
