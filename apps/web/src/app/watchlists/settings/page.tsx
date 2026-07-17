import Link from 'next/link';
import { Page } from '../../components';
import { WatchlistSettings } from '../watchlist-settings';

export default function WatchlistSettingsPage() {
  return (
    <Page title="Manage watchlists">
      <p className="lede">Create watchlists and add the tokens and wallets you want to track.</p>
      <div className="actions">
        <Link href="/watchlists">Back to watchlists</Link>
      </div>
      <WatchlistSettings />
    </Page>
  );
}
