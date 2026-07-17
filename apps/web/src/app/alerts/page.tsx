import Link from 'next/link';
import { Page } from '../components';
import { AlertFeed } from './alert-feed';

export default function Alerts() {
  return (
    <Page title="Alerts">
      <p className="lede">What fired, and the evidence behind it.</p>
      <div className="actions">
        <Link href="/alerts/settings">Alert settings</Link>
      </div>
      <AlertFeed />
    </Page>
  );
}
