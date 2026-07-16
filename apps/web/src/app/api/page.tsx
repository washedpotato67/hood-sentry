import { Page } from '../components';
import { ApiKeyDashboard } from './api-key-dashboard';
export default function Api() {
  return (
    <Page title="API">
      <p className="lede">
        Issue scoped keys with per-minute and daily quotas. Secrets appear once.
      </p>
      <ApiKeyDashboard />
    </Page>
  );
}
