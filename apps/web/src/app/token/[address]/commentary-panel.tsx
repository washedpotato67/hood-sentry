'use client';

import { useState } from 'react';
import { apiRequest, chainId } from '../../../lib/api';
import { useSession } from '../../use-session';

type Commentary = {
  commentary: {
    summary: string;
    evidenceHighlights: readonly string[];
    limitations: readonly string[];
    userActions: readonly string[];
  };
  providerId: string;
  model: string;
  promptVersion: string;
  fetchedAt: string;
  scan: {
    id: string;
    engineVersion: string;
    rulesetVersion: string;
    methodologyVersion: string;
    sourceBlock: string;
  };
  affectsRiskFindings: false;
  affectsRiskScore: false;
};

export function CommentaryPanel({ address }: { address: string }) {
  const { session } = useSession();
  const [result, setResult] = useState<Commentary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function explain() {
    setBusy(true);
    setError(null);
    const response = await apiRequest<Commentary>(
      `/v1/tokens/${encodeURIComponent(address)}/risk-commentary?chainId=${chainId()}`,
      { method: 'POST', body: '{}' },
    );
    setBusy(false);
    if (response.ok) setResult(response.data);
    else setError(response.message);
  }

  return (
    <section className="panel">
      <h2>AI report commentary</h2>
      <p>
        Commentary explains the current deterministic report. The response does not change findings
        or scores.
      </p>
      {session?.authenticated ? (
        <button className="primary" type="button" onClick={explain} disabled={busy}>
          {busy ? 'Generating commentary…' : 'Explain this report'}
        </button>
      ) : (
        <p>Sign in with your wallet to request commentary.</p>
      )}
      {error === null ? null : <p className="error">{error}</p>}
      {result === null ? null : (
        <div className="stack">
          <p>{result.commentary.summary}</p>
          <h3>Evidence highlights</h3>
          <ul>
            {result.commentary.evidenceHighlights.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h3>Limits</h3>
          <ul>
            {result.commentary.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h3>Review steps</h3>
          <ul>
            {result.commentary.userActions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="muted">
            Scan {result.scan.id}, block {result.scan.sourceBlock}, ruleset{' '}
            {result.scan.rulesetVersion}, model {result.model}, prompt {result.promptVersion}
          </p>
        </div>
      )}
    </section>
  );
}
