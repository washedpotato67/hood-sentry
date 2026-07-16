'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiRequest, compactAddress } from '../../../lib/api';
import { useSession } from '../../use-session';

type Contract = {
  id: string;
  contractAddress: string;
  contractType: string;
  verified: boolean;
};

type Project = {
  id: string;
  chainId: number;
  projectName: string;
  slug: string;
  description: string | null;
  websiteUrl: string | null;
  logoUri: string | null;
  verified: boolean;
  verifiedAt: string | null;
  contracts: readonly Contract[];
};

type Claim = {
  id: string;
  projectProfileId: string;
  claimType: string;
  status: string;
  createdAt: string;
};

type ClaimIntent = {
  intent: string;
  message: string;
  walletAddress: string;
  deadline: string;
};

export function ProjectDetailDashboard({ project }: { project: Project }) {
  const { session } = useSession();
  const [claims, setClaims] = useState<readonly Claim[]>([]);
  const [claimType, setClaimType] = useState<'ownership' | 'maintainer' | 'contributor'>(
    'ownership',
  );
  const [contractAddress, setContractAddress] = useState('');
  const [contractType, setContractType] = useState('token');
  const [projectName, setProjectName] = useState(project.projectName);
  const [description, setDescription] = useState(project.description ?? '');
  const [websiteUrl, setWebsiteUrl] = useState(project.websiteUrl ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadClaims = useCallback(async () => {
    const result = await apiRequest<readonly Claim[]>('/v1/project-claims');
    if (result.ok) {
      setClaims(result.data.filter((claim) => claim.projectProfileId === project.id));
    }
  }, [project.id]);

  useEffect(() => {
    if (session?.authenticated) void loadClaims();
  }, [session, loadClaims]);

  async function submitClaim() {
    const provider = window.ethereum;
    if (provider === undefined) {
      setMessage('No EVM wallet provider is available.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const intentResult = await apiRequest<ClaimIntent>('/v1/projects/claim-intent', {
        method: 'POST',
        body: JSON.stringify({ projectProfileId: project.id, claimType }),
      });
      if (!intentResult.ok) throw new Error(intentResult.message);
      const intent = intentResult.data;
      const accounts = await provider.request({ method: 'eth_accounts' });
      const account =
        Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : null;
      if (account?.toLowerCase() !== intent.walletAddress.toLowerCase()) {
        throw new Error('Select the wallet linked to this Hood Sentry session.');
      }
      const signature = await provider.request({
        method: 'personal_sign',
        params: [intent.message, intent.walletAddress],
      });
      if (typeof signature !== 'string') throw new Error('The wallet returned no signature.');
      const claimResult = await apiRequest<Claim>('/v1/projects/claim', {
        method: 'POST',
        body: JSON.stringify({ intent: intent.intent, signature }),
      });
      if (!claimResult.ok) throw new Error(claimResult.message);
      setMessage('Claim submitted for identity review.');
      await loadClaims();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Project claim failed.');
    } finally {
      setBusy(false);
    }
  }

  async function addContract() {
    setBusy(true);
    const result = await apiRequest<Contract>(`/v1/projects/${project.id}/contracts`, {
      method: 'POST',
      body: JSON.stringify({
        chainId: project.chainId,
        contractAddress,
        contractType,
      }),
    });
    setBusy(false);
    if (result.ok) {
      setContractAddress('');
      setMessage('Contract registered. Reload the page to view the indexed verification state.');
    } else setMessage(result.message);
  }

  async function updateProfile() {
    setBusy(true);
    const result = await apiRequest(`/v1/projects/${project.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        projectName,
        description: description || null,
        websiteUrl: websiteUrl || null,
      }),
    });
    setBusy(false);
    setMessage(result.ok ? 'Project profile updated.' : result.message);
  }

  const approved = claims.some(
    (claim) => claim.claimType === 'ownership' && claim.status === 'approved',
  );

  return (
    <div className="stack">
      <section className="panel">
        <div className="metric-row">
          <span>Identity</span>
          <span className={`badge ${project.verified ? 'status-ready' : ''}`}>
            {project.verified ? 'Verified' : 'Unverified'}
          </span>
        </div>
        <div className="metric-row">
          <span>Chain ID</span>
          <strong>{project.chainId}</strong>
        </div>
        {project.description === null ? null : <p>{project.description}</p>}
        {project.websiteUrl === null ? null : (
          <a href={project.websiteUrl} rel="noreferrer" target="_blank">
            {project.websiteUrl}
          </a>
        )}
      </section>
      <section className="panel">
        <h2>Registered contracts</h2>
        {project.contracts.length === 0 ? <p className="muted">No contracts registered.</p> : null}
        {project.contracts.map((contract) => (
          <div className="metric-row" key={contract.id}>
            <span>
              <strong>{contract.contractType}</strong>
              <br />
              <code>{compactAddress(contract.contractAddress)}</code>
            </span>
            <span className={`badge ${contract.verified ? 'status-ready' : ''}`}>
              {contract.verified ? 'Source verified' : 'Unverified'}
            </span>
          </div>
        ))}
      </section>
      {!session?.authenticated ? (
        <section className="panel">Sign in to claim or maintain this project.</section>
      ) : (
        <>
          <section className="panel">
            <h2>Project claim</h2>
            <div className="actions">
              <select
                value={claimType}
                onChange={(event) =>
                  setClaimType(
                    event.target.value === 'maintainer'
                      ? 'maintainer'
                      : event.target.value === 'contributor'
                        ? 'contributor'
                        : 'ownership',
                  )
                }
              >
                <option value="ownership">Ownership</option>
                <option value="maintainer">Maintainer</option>
                <option value="contributor">Contributor</option>
              </select>
              <button className="primary" type="button" onClick={submitClaim} disabled={busy}>
                Sign and submit claim
              </button>
            </div>
            {claims.map((claim) => (
              <div className="metric-row" key={claim.id}>
                <span>{claim.claimType}</span>
                <span className={`badge ${claim.status === 'approved' ? 'status-ready' : ''}`}>
                  {claim.status}
                </span>
              </div>
            ))}
          </section>
          <section className="panel">
            <h2>Owner controls</h2>
            <p className="muted">An approved ownership claim is required.</p>
            <div className="form-grid">
              <label className="field">
                Project name
                <input
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                />
              </label>
              <label className="field">
                Website
                <input value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} />
              </label>
            </div>
            <label className="field">
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <button type="button" onClick={updateProfile} disabled={busy || !approved}>
              Save profile
            </button>
            <div className="form-grid">
              <label className="field">
                Contract address
                <input
                  value={contractAddress}
                  onChange={(event) => setContractAddress(event.target.value)}
                  placeholder="0x…"
                />
              </label>
              <label className="field">
                Contract type
                <select
                  value={contractType}
                  onChange={(event) => setContractType(event.target.value)}
                >
                  {[
                    'token',
                    'staking',
                    'governance',
                    'treasury',
                    'bond',
                    'vesting',
                    'factory',
                    'router',
                  ].map((value) => (
                    <option value={value} key={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="button"
              onClick={addContract}
              disabled={busy || !approved || contractAddress.length !== 42}
            >
              Register contract
            </button>
          </section>
        </>
      )}
      {message === null ? null : <section className="panel">{message}</section>}
    </div>
  );
}
