import { Page, Stat, Unavailable } from '../components';
export default function Portfolio() {
  return (
    <Page title="Portfolio">
      <div className="grid">
        <Stat label="Total value" />
        <Stat label="Exact value" />
        <Stat label="Estimated value" />
        <Stat label="Realized P&L" />
        <Stat label="Unrealized P&L" />
      </div>
      <section className="panel">
        <h2>Holdings</h2>
        <Unavailable label="Wallet connection" />
      </section>
    </Page>
  );
}
