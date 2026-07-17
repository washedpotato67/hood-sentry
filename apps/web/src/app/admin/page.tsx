import type { Metadata } from 'next';
import { Page } from '../components';
import { AdminDashboard } from './admin-dashboard';

// Moderation console — not linked publicly and kept out of search indexes.
// Authorization is enforced server-side by the API on every /v1/admin/* call.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <Page title="Moderation console">
      <p className="lede">
        Review project identity claims, community reports, appeals, and append-only audit records.
      </p>
      <AdminDashboard />
    </Page>
  );
}
