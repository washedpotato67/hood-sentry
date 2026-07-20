'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';

/**
 * A quiet operational indicator for the footer. Readiness belongs here, not as a
 * homepage hero stat where "degraded" reads as the product being broken; here it
 * is ambient context that stays out of the way when everything is fine.
 */
export function StatusDot() {
  const [state, setState] = useState<'ok' | 'degraded' | 'unknown'>('unknown');

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const res = await apiRequest<{ status: string }>('/health/ready');
      if (cancelled) return;
      setState(res.ok && res.data.status === 'ready' ? 'ok' : 'degraded');
    };
    void check();
    const id = window.setInterval(check, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const label =
    state === 'ok'
      ? 'All systems operational'
      : state === 'degraded'
        ? 'Partial availability'
        : 'Checking…';
  return (
    <span className={`status-dot status-${state}`} title={label}>
      <span className="status-dot-mark" aria-hidden="true" />
      {label}
    </span>
  );
}
