import { apiRequest, chainId } from '../../lib/api';
import { Page } from '../components';
import { TradePanel } from './trade-panel';

type TradingStatus = { available: boolean; writesEnabled: boolean };

export default async function Trade({
  searchParams,
}: {
  searchParams: Promise<{ input?: string }>;
}) {
  const query = await searchParams;
  // Trading is gated by configuration, and when it is off every quote fails on
  // the server. Showing the form regardless invites people to fill it in and
  // hands them a schema error for an answer, so say so before they start.
  const status = await apiRequest<TradingStatus>(`/v1/trading/status?chainId=${chainId()}`);
  const available = status.ok && status.data.available;

  return (
    <Page title="Trade">
      <p className="lede">
        Sentry selects verified routes and returns calldata only after chain checks and simulation.
        Your wallet signs and broadcasts.
      </p>
      {available ? (
        <TradePanel initialInput={query.input ?? ''} />
      ) : (
        <section className="panel">
          <h2>Trading is not enabled</h2>
          <p className="muted">
            Routing and quotes are switched off for this deployment, so no quote can be returned and
            no transaction can be prepared. Research, discovery and risk reports are unaffected.
          </p>
        </section>
      )}
    </Page>
  );
}
