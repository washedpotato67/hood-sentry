import { Page, Stat } from '../../components';
export default async function Wallet({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return (
    <Page title="Public wallet">
      <p className="muted">
        Address: <code>{address}</code>
      </p>
      <div className="grid">
        <Stat label="ETH balance" />
        <Stat label="Estimated value" />
        <Stat label="Risk exposure" />
        <Stat label="Approvals" />
      </div>
    </Page>
  );
}
