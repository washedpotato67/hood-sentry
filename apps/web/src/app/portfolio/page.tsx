import { Page } from '../components';
import { PortfolioDashboard } from './portfolio-dashboard';
export default function Portfolio() {
  return (
    <Page title="Portfolio">
      <p className="lede">
        Exact balances and evidence-labeled valuations for your signed-in wallet.
      </p>
      <PortfolioDashboard />
    </Page>
  );
}
