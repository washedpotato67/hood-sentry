'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiRequest, chainId } from '../../lib/api';
import { useSession } from '../use-session';

export function ProjectDashboard() {
  const router = useRouter();
  const { session } = useSession();
  const [projectName, setProjectName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setMessage(null);
    const result = await apiRequest<{ id: string }>('/v1/projects', {
      method: 'POST',
      body: JSON.stringify({
        chainId: chainId(),
        projectName,
        slug,
        description: description || null,
        websiteUrl: websiteUrl || null,
        logoUri: null,
      }),
    });
    setBusy(false);
    setMessage(
      result.ok ? 'Project profile created. Submit an ownership claim next.' : result.message,
    );
    if (result.ok) router.push(`/projects/${slug}`);
  }

  if (session === null || !session.authenticated) {
    return <p className="muted">Sign in to create and claim a project profile.</p>;
  }
  return (
    <section className="panel">
      <h2>Create project profile</h2>
      <div className="form-grid">
        <label className="field">
          Project name
          <input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
        </label>
        <label className="field">
          Slug
          <input
            value={slug}
            onChange={(event) =>
              setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
            }
          />
        </label>
        <label className="field">
          Website
          <input
            type="url"
            value={websiteUrl}
            onChange={(event) => setWebsiteUrl(event.target.value)}
            placeholder="https://"
          />
        </label>
      </div>
      <label className="field">
        Description
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <div className="actions">
        <button
          className="primary"
          type="button"
          onClick={submit}
          disabled={busy || projectName.trim().length === 0 || slug.length === 0}
        >
          Create profile
        </button>
      </div>
      {message === null ? null : <p>{message}</p>}
    </section>
  );
}
