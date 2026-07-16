'use client';

import { useState } from 'react';
import { apiRequest, chainId } from '../../../lib/api';
import { useSession } from '../../use-session';

export function ReportForm({ address }: { address: string }) {
  const { session } = useSession();
  const [reportType, setReportType] = useState('scam');
  const [severity, setSeverity] = useState('high');
  const [description, setDescription] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const result = await apiRequest<{ id: string }>('/v1/reports', {
      method: 'POST',
      body: JSON.stringify({
        chainId: chainId(),
        targetAddress: address,
        targetType: 'token',
        reportType,
        severity,
        description,
        evidenceUrls: evidenceUrl.trim().length === 0 ? [] : [evidenceUrl.trim()],
      }),
    });
    setBusy(false);
    setMessage(result.ok ? `Report ${result.data.id} submitted for moderation.` : result.message);
    if (result.ok) {
      setDescription('');
      setEvidenceUrl('');
    }
  }

  return (
    <section className="panel">
      <h2>Community report</h2>
      {!session?.authenticated ? (
        <p className="muted">Sign in to submit evidence for moderator review.</p>
      ) : (
        <>
          <div className="form-grid">
            <label className="field">
              Report type
              <select value={reportType} onChange={(event) => setReportType(event.target.value)}>
                <option value="scam">Scam</option>
                <option value="rug_pull">Rug pull</option>
                <option value="honeypot">Honeypot</option>
                <option value="exploit">Exploit</option>
                <option value="phishing">Phishing</option>
                <option value="impersonation">Impersonation</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="field">
              Severity
              <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <label className="field">
              Evidence URL
              <input
                type="url"
                value={evidenceUrl}
                onChange={(event) => setEvidenceUrl(event.target.value)}
                placeholder="https://"
              />
            </label>
          </div>
          <label className="field">
            Evidence summary
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              minLength={30}
              maxLength={10000}
            />
          </label>
          <div className="actions">
            <button
              className="primary"
              type="button"
              onClick={submit}
              disabled={busy || description.trim().length < 30}
            >
              Submit report
            </button>
          </div>
        </>
      )}
      {message === null ? null : <p>{message}</p>}
    </section>
  );
}
