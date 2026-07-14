import { Page, Stat } from '../components';
export default function StockTokens() {
  return (
    <Page title="Canonical Stock Tokens and ETFs">
      <p className="muted">Canonical identity requires a verified contract address.</p>
      <div className="grid">
        <Stat label="Stock Tokens" />
        <Stat label="ETFs" />
        <Stat label="Oracle health" />
      </div>
    </Page>
  );
}
