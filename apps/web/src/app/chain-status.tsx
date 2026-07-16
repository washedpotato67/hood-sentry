'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';

type Ready = { status: string };

export function ChainStatus() {
  const [status, setStatus] = useState<'checking' | 'ready' | 'degraded'>('checking');
  useEffect(() => {
    const load = () => {
      void apiRequest<Ready>('/health/ready').then((result) => {
        setStatus(result.ok && result.data.status === 'ready' ? 'ready' : 'degraded');
      });
    };
    load();
    const interval = window.setInterval(load, 30_000);
    return () => window.clearInterval(interval);
  }, []);
  return <span className={`badge status-${status}`}>Chain {status}</span>;
}
