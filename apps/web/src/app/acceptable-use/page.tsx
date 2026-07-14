import { LegalTemplate } from '../legal-template';
export default function AcceptableUse() {
  return (
    <LegalTemplate
      title="Acceptable use"
      items={[
        'No abuse, phishing, or unauthorized access.',
        'No manipulation of alerts, reports, or public data.',
        '[Legal review required for enforcement process]',
      ]}
    />
  );
}
