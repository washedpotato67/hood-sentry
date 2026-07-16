import { apiRequest, compactAddress } from '../../../lib/api';
import { ErrorPanel, Page } from '../../components';
import { ReportDetailActions } from './report-detail-actions';

type ReportDetail = {
  id: string;
  chainId: number;
  targetAddress: string;
  targetType: string;
  reporterAddress: string;
  reportType: string;
  severity: string;
  description: string;
  evidenceUrls: readonly string[];
  status: string;
  submittedAt: string;
  evidence: readonly {
    id: string;
    evidenceType: string;
    evidenceData: unknown;
    submittedAt: string;
  }[];
  resolutions: readonly {
    id: string;
    resolutionType: string;
    resolutionNotes: string | null;
    resolvedAt: string;
  }[];
  appeals: readonly {
    id: string;
    appealReason: string;
    status: string;
    submittedAt: string;
  }[];
};

export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await apiRequest<ReportDetail>(`/v1/reports/${encodeURIComponent(id)}`);
  if (!result.ok) {
    return (
      <Page title="Community report">
        <ErrorPanel code={result.code} message={result.message} />
      </Page>
    );
  }
  const report = result.data;
  return (
    <Page title={`${report.reportType} report`}>
      <div className="grid">
        <section className="panel">
          <div className="muted">Status</div>
          <strong>{report.status}</strong>
        </section>
        <section className="panel">
          <div className="muted">Severity</div>
          <strong>{report.severity}</strong>
        </section>
        <section className="panel">
          <div className="muted">Target</div>
          <code>{compactAddress(report.targetAddress)}</code>
        </section>
      </div>
      <section className="panel">
        <h2>Submitted statement</h2>
        <p>{report.description}</p>
        {report.evidenceUrls.map((url) => (
          <p key={url}>
            <a href={url} rel="noreferrer" target="_blank">
              {url}
            </a>
          </p>
        ))}
      </section>
      <section className="panel">
        <h2>Evidence log</h2>
        {report.evidence.length === 0 ? <p className="muted">No extra evidence.</p> : null}
        {report.evidence.map((evidence) => (
          <div className="metric-row" key={evidence.id}>
            <strong>{evidence.evidenceType}</strong>
            <code>{JSON.stringify(evidence.evidenceData)}</code>
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>Moderator decisions</h2>
        {report.resolutions.length === 0 ? <p className="muted">No final decision.</p> : null}
        {report.resolutions.map((resolution) => (
          <div key={resolution.id}>
            <strong>{resolution.resolutionType}</strong>
            {resolution.resolutionNotes === null ? null : <p>{resolution.resolutionNotes}</p>}
          </div>
        ))}
      </section>
      <ReportDetailActions reportId={report.id} status={report.status} />
    </Page>
  );
}
