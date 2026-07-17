import Link from 'next/link';
import { Page } from '../../components';
import { AlertSettings } from '../alert-settings';

export default function AlertSettingsPage() {
  return (
    <Page title="Alert settings">
      <p className="lede">
        Create deterministic rules and choose where they deliver. Notifications only fire from
        indexed evidence.
      </p>
      <div className="actions">
        <Link href="/alerts">Back to alerts</Link>
      </div>
      <AlertSettings />
    </Page>
  );
}
