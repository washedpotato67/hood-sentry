import { Page } from '../components';
import { TradePanel } from './trade-panel';

export default async function Trade({
  searchParams,
}: {
  searchParams: Promise<{ input?: string }>;
}) {
  const query = await searchParams;
  return (
    <Page title="Trade">
      <p className="lede">
        Sentry selects verified routes and returns calldata only after chain checks and simulation.
        Your wallet signs and broadcasts.
      </p>
      <TradePanel initialInput={query.input ?? ''} />
    </Page>
  );
}
