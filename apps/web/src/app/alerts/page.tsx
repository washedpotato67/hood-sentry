import { Page } from '../components';
import { AlertDashboard } from './alert-dashboard';
export default function Alerts() {
  return (
    <Page title="Alerts">
      <p className="lede">
        Create deterministic rules. Notifications only fire from indexed evidence.
      </p>
      <AlertDashboard />
    </Page>
  );
}
