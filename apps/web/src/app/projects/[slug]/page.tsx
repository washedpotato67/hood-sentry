import { apiRequest } from '../../../lib/api';
import { ErrorPanel, Page } from '../../components';
import { ProjectDetailDashboard } from './project-detail-dashboard';

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
  contracts: readonly {
    id: string;
    contractAddress: string;
    contractType: string;
    verified: boolean;
  }[];
};

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await apiRequest<Project>(`/v1/projects/${encodeURIComponent(slug)}`);
  if (!result.ok) {
    return (
      <Page title="Project">
        <ErrorPanel code={result.code} message={result.message} />
      </Page>
    );
  }
  return (
    <Page title={result.data.projectName}>
      <p className="lede">
        Identity status, registered contracts, profile history, and community reports.
      </p>
      <ProjectDetailDashboard project={result.data} />
    </Page>
  );
}
