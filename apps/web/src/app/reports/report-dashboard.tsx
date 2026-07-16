'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiRequest, compactAddress } from '../../lib/api';
import { useSession } from '../use-session';

type Report = {
  id: string;
  targetAddress: string;
  targetType: string;
  reportType: string;
  severity: string;
  status: string;
  submittedAt: string;
};

export function ReportDashboard() {
  const { session } = useSession();
  const [reports, setReports] = useState<readonly Report[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await apiRequest<readonly Report[]>('/v1/reports?limit=100');
    if (result.ok) setReports(result.data);
    else setError(result.message);
  }, []);

  useEffect(() => {
    if (session?.authenticated) void load();
  }, [session, load]);

  if (!session?.authenticated)
    return <section className="panel">Sign in to view your reports.</section>;
  return (
    <section className="panel">
      {reports.length === 0 ? <p className="muted">No reports submitted.</p> : null}
      {reports.map((report) => (
        <div className="metric-row" key={report.id}>
          <span>
            <Link href={`/reports/${report.id}`}>
              <strong>{report.reportType}</strong>
            </Link>
            <br />
            <code>{compactAddress(report.targetAddress)}</code>
          </span>
          <span className="actions">
            <span className="badge">{report.severity}</span>
            <span className={`badge ${report.status === 'upheld' ? 'status-ready' : ''}`}>
              {report.status}
            </span>
          </span>
        </div>
      ))}
      {error === null ? null : <p className="error">{error}</p>}
    </section>
  );
}
