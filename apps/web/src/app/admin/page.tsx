import { Page } from '../components';
import { AdminDashboard } from './admin-dashboard';

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
