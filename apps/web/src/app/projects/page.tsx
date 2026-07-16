import Link from 'next/link';
import { apiRequest, chainId } from '../../lib/api';
import { ErrorPanel, Page } from '../components';
import { ProjectDashboard } from './project-dashboard';

type Project = {
  id: string;
  projectName: string;
  slug: string;
  description: string | null;
  websiteUrl: string | null;
  verified: boolean;
};
type ProjectPage = { data: readonly Project[] };

export default async function Projects() {
  const projects = await apiRequest<ProjectPage>(`/v1/projects?chainId=${chainId()}&limit=100`);
  return (
    <Page title="Projects">
      <p className="lede">Official project identity stays separate from contract risk evidence.</p>
      <ProjectDashboard />
      {projects.ok ? (
        <section className="panel">
          <h2>Project directory</h2>
          {projects.data.data.length === 0 ? (
            <p className="muted">No project profiles yet.</p>
          ) : null}
          {projects.data.data.map((project) => (
            <div className="metric-row" key={project.id}>
              <span>
                <Link href={`/projects/${project.slug}`}>
                  <strong>{project.projectName}</strong>
                </Link>
                <br />
                <small className="muted">/{project.slug}</small>
              </span>
              <span className={`badge ${project.verified ? 'status-ready' : ''}`}>
                {project.verified ? 'Verified' : 'Unverified'}
              </span>
            </div>
          ))}
        </section>
      ) : (
        <ErrorPanel code={projects.code} message={projects.message} />
      )}
    </Page>
  );
}
