import { Page } from '../components';
import { WatchlistDashboard } from './watchlist-dashboard';
export default function Watchlists() {
  return (
    <Page title="Watchlists">
      <p className="lede">
        Group tokens and wallets, then attach alert rules to the targets you track.
      </p>
      <WatchlistDashboard />
    </Page>
  );
}
