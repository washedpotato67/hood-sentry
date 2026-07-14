import { LegalTemplate } from '../legal-template';
export default function SentryUtilityNotice() {
  return (
    <LegalTemplate
      title="$SENTRY utility notice"
      items={[
        'Utility access is subject to configured entitlements.',
        'No guaranteed return, revenue share, or passive income promise is made.',
        'Token volatility and irreversible blockchain transactions carry risk.',
      ]}
    />
  );
}
