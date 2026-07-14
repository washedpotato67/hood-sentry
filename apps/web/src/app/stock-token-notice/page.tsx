import { LegalTemplate } from '../legal-template';
export default function StockTokenNotice() {
  return (
    <LegalTemplate
      title="Stock Token notice"
      items={[
        'Eligibility and availability vary by jurisdiction.',
        'Stock Tokens are not described as equity by this application.',
        'Prices, eligibility, and provider data may be unavailable.',
      ]}
    />
  );
}
