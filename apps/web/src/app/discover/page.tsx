import { Page, Stat, Unavailable } from '../components';
export default function Discover() {
  return (
    <Page title="Discover">
      <p className="muted">Organic discovery feeds. Sponsored placement stays separate.</p>
      <div className="grid">
        <Stat label="New tokens" />
        <Stat label="Trending" />
        <Stat label="Volume gainers" />
        <Stat label="Liquidity gainers" />
        <Stat label="Recently graduated" />
        <Stat label="Recently migrated" />
      </div>
      <section className="panel">
        <h2>Results</h2>
        <Unavailable label="Indexed discovery data" />
      </section>
    </Page>
  );
}
