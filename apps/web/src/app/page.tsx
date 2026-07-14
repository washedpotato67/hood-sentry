import { Page, Stat } from './components';
export default function Home() {
  return (
    <Page title="Robinhood Chain safety terminal">
      <p className="muted">Evidence-based token, wallet, liquidity, and protocol intelligence.</p>
      <div className="grid">
        <Stat label="Trending" />
        <Stat label="New tokens" />
        <Stat label="Critical findings" />
        <Stat label="Chain status" />
      </div>
    </Page>
  );
}
