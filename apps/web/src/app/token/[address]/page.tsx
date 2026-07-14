import { Page, Stat, Unavailable } from '../../components';
export default async function Token({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return (
    <Page title="Token">
      <p className="muted">
        Address: <code>{address}</code>
      </p>
      <div className="grid">
        <Stat label="Price" />
        <Stat label="Liquidity" />
        <Stat label="Market cap" />
        <Stat label="Holders" />
        <Stat label="Risk grade" />
        <Stat label="Completeness" />
      </div>
      <section className="panel">
        <h2>Risk</h2>
        <Unavailable label="Evidence-backed scan" />
      </section>
    </Page>
  );
}
