import { Page } from '../components';
export default function Trade() {
  return (
    <Page title="Trade">
      <p className="unavailable">
        Trading is disabled until quote, simulation, and transaction-intent checks pass.
      </p>
    </Page>
  );
}
