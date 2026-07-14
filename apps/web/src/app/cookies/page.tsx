import { LegalTemplate } from '../legal-template';
export default function Cookies() {
  return (
    <LegalTemplate
      title="Cookie notice"
      items={[
        '[Describe necessary cookies]',
        '[Describe analytics consent]',
        '[Describe retention and opt-out]',
      ]}
    />
  );
}
