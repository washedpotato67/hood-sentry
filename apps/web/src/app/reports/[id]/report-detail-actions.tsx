'use client';

import { useState } from 'react';
import { apiRequest } from '../../../lib/api';
import { useSession } from '../../use-session';

export function ReportDetailActions({ reportId, status }: { reportId: string; status: string }) {
  const { session } = useSession();
  const [evidenceType, setEvidenceType] = useState<'url' | 'transaction_hash' | 'document'>('url');
  const [evidenceValue, setEvidenceValue] = useState('');
  const [appealReason, setAppealReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function addEvidence() {
    setBusy(true);
    const result = await apiRequest(`/v1/reports/${reportId}/evidence`, {
      method: 'POST',
      body: JSON.stringify({
        evidenceType,
        evidenceData: { value: evidenceValue },
      }),
    });
    setBusy(false);
    setMessage(result.ok ? 'Evidence attached. Reload to view the updated log.' : result.message);
    if (result.ok) setEvidenceValue('');
  }

  async function appeal() {
    setBusy(true);
    const result = await apiRequest(`/v1/reports/${reportId}/appeal`, {
      method: 'POST',
      body: JSON.stringify({ reason: appealReason }),
    });
    setBusy(false);
    setMessage(result.ok ? 'Appeal submitted for review.' : result.message);
    if (result.ok) setAppealReason('');
  }

  if (!session?.authenticated) return <section className="panel">Sign in to add evidence.</section>;
  return (
    <div className="stack">
      <section className="panel">
        <h2>Add evidence</h2>
        <div className="form-grid">
          <label className="field">
            Evidence type
            <select
              value={evidenceType}
              onChange={(event) =>
                setEvidenceType(
                  event.target.value === 'transaction_hash'
                    ? 'transaction_hash'
                    : event.target.value === 'document'
                      ? 'document'
                      : 'url',
                )
              }
            >
              <option value="url">URL</option>
              <option value="transaction_hash">Transaction hash</option>
              <option value="document">Document reference</option>
            </select>
          </label>
          <label className="field">
            Value
            <input
              value={evidenceValue}
              onChange={(event) => setEvidenceValue(event.target.value)}
            />
          </label>
        </div>
        <button type="button" onClick={addEvidence} disabled={busy || evidenceValue.length === 0}>
          Attach evidence
        </button>
      </section>
      {status === 'upheld' || status === 'rejected' ? (
        <section className="panel">
          <h2>Appeal decision</h2>
          <textarea
            value={appealReason}
            onChange={(event) => setAppealReason(event.target.value)}
            minLength={30}
            maxLength={10000}
          />
          <button type="button" onClick={appeal} disabled={busy || appealReason.trim().length < 30}>
            Submit appeal
          </button>
        </section>
      ) : null}
      {message === null ? null : <section className="panel">{message}</section>}
    </div>
  );
}
