import { LegalTemplate } from '../legal-template';
export default function ApiTerms() {
  return (
    <LegalTemplate
      title="API terms"
      items={[
        'API access is rate-limited and scoped.',
        'Do not expose API secrets.',
        '[Billing and support terms require legal review].',
      ]}
    />
  );
}
