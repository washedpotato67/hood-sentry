import Link from 'next/link';
import { Page } from '../components';
import { WatchlistList } from './watchlist-list';

export default function Watchlists() {
  return (
    <Page title="Watchlists">
      <p className="lede">The tokens and wallets you track.</p>
      <div className="actions">
        <Link href="/watchlists/settings">Manage watchlists</Link>
      </div>
      <WatchlistList />
    </Page>
  );
}
