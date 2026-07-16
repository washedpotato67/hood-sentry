'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiRequest, compactAddress } from '../../lib/api';
import { useSession } from '../use-session';

type AdminSession = { roles: readonly string[] };
type ClaimRow = {
  claim: {
    id: string;
    claimerAddress: string;
    claimType: string;
    status: string;
  };
  projectName: string;
  projectSlug: string;
  chainId: number;
};
type Report = {
  id: string;
  targetAddress: string;
  reportType: string;
  severity: string;
  status: string;
  description: string;
};
type AppealRow = {
  appeal: { id: string; status: string; appealReason: string };
  report: Report;
};
type AuditRecord = {
  id: string;
  actionType: string;
  targetType: string;
  targetId: string;
  performedAt: string;
};

export function AdminDashboard() {
  const { session } = useSession();
  const [admin, setAdmin] = useState<AdminSession | null>(null);
  const [claims, setClaims] = useState<readonly ClaimRow[]>([]);
  const [reports, setReports] = useState<readonly Report[]>([]);
  const [appeals, setAppeals] = useState<readonly AppealRow[]>([]);
  const [audit, setAudit] = useState<readonly AuditRecord[]>([]);
  const [reason, setReason] = useState(
    'Reviewed against the submitted evidence and indexed chain facts.',
  );
  const [resolutionType, setResolutionType] = useState('upheld');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const adminResult = await apiRequest<AdminSession>('/v1/admin/session');
    if (!adminResult.ok) {
      setMessage(adminResult.message);
      return;
    }
    setAdmin(adminResult.data);
    const [claimResult, reportResult, appealResult, auditResult] = await Promise.all([
      apiRequest<readonly ClaimRow[]>('/v1/admin/project-claims?status=pending&limit=100'),
      apiRequest<readonly Report[]>('/v1/admin/reports?limit=100'),
      apiRequest<readonly AppealRow[]>('/v1/admin/report-appeals?status=pending&limit=100'),
      apiRequest<readonly AuditRecord[]>('/v1/admin/audit-log?limit=50'),
    ]);
    if (claimResult.ok) setClaims(claimResult.data);
    if (reportResult.ok) setReports(reportResult.data);
    if (appealResult.ok) setAppeals(appealResult.data);
    if (auditResult.ok) setAudit(auditResult.data);
  }, []);

  useEffect(() => {
    if (session?.authenticated) void load();
  }, [session, load]);

  async function reviewClaim(id: string, status: 'approved' | 'rejected') {
    setBusy(true);
    const result = await apiRequest(`/v1/admin/project-claims/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ status, reason }),
    });
    setBusy(false);
    setMessage(result.ok ? `Claim ${status}.` : result.message);
    if (result.ok) await load();
  }

  async function reviewReport(id: string) {
    setBusy(true);
    const result = await apiRequest(`/v1/admin/reports/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ action: 'resolve', resolutionType, notes: reason }),
    });
    setBusy(false);
    setMessage(result.ok ? 'Report resolution recorded.' : result.message);
    if (result.ok) await load();
  }

  async function reviewAppeal(id: string, status: 'accepted' | 'rejected') {
    setBusy(true);
    const result = await apiRequest(`/v1/admin/report-appeals/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ status, reason }),
    });
    setBusy(false);
    setMessage(result.ok ? `Appeal ${status}.` : result.message);
    if (result.ok) await load();
  }

  if (!session?.authenticated)
    return <section className="panel">Sign in with an admin wallet.</section>;
  if (admin === null)
    return <section className="panel">{message ?? 'Checking admin access…'}</section>;
  return (
    <div className="stack">
      <section className="panel">
        <div className="metric-row">
          <span>Active roles</span>
          <strong>{admin.roles.join(', ')}</strong>
        </div>
        <label className="field">
          Review reason
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
      </section>
      <section className="panel">
        <h2>Pending project claims</h2>
        {claims.length === 0 ? <p className="muted">No pending claims.</p> : null}
        {claims.map((row) => (
          <div className="metric-row" key={row.claim.id}>
            <span>
              <strong>{row.projectName}</strong> · {row.claim.claimType}
              <br />
              <code>{compactAddress(row.claim.claimerAddress)}</code>
            </span>
            <span className="actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => reviewClaim(row.claim.id, 'approved')}
              >
                Approve
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => reviewClaim(row.claim.id, 'rejected')}
              >
                Reject
              </button>
            </span>
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>Community reports</h2>
        <label className="field">
          Resolution
          <select
            value={resolutionType}
            onChange={(event) => setResolutionType(event.target.value)}
          >
            <option value="upheld">Upheld</option>
            <option value="rejected">Rejected</option>
            <option value="dismissed">Dismissed</option>
            <option value="escalated">Escalated</option>
          </select>
        </label>
        {reports.map((report) => (
          <div className="metric-row" key={report.id}>
            <span>
              <strong>{report.reportType}</strong> · {report.severity} · {report.status}
              <br />
              <small>{report.description}</small>
            </span>
            <button type="button" disabled={busy} onClick={() => reviewReport(report.id)}>
              Record resolution
            </button>
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>Pending appeals</h2>
        {appeals.length === 0 ? <p className="muted">No pending appeals.</p> : null}
        {appeals.map((row) => (
          <div className="metric-row" key={row.appeal.id}>
            <span>{row.appeal.appealReason}</span>
            <span className="actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => reviewAppeal(row.appeal.id, 'accepted')}
              >
                Accept
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => reviewAppeal(row.appeal.id, 'rejected')}
              >
                Reject
              </button>
            </span>
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>Audit log</h2>
        {audit.map((record) => (
          <div className="metric-row" key={record.id}>
            <span>
              {record.actionType} {record.targetType}
            </span>
            <code>{record.targetId}</code>
          </div>
        ))}
      </section>
      {message === null ? null : <section className="panel">{message}</section>}
    </div>
  );
}
