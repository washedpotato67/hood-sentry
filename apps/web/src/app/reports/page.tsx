import { Page } from '../components';
import { ReportDashboard } from './report-dashboard';

export default function ReportsPage() {
  return (
    <Page title="Community reports">
      <p className="lede">
        Track your submissions, attach evidence, read moderator resolutions, and appeal final
        decisions.
      </p>
      <ReportDashboard />
    </Page>
  );
}
