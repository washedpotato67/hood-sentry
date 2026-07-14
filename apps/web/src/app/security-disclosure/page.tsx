import { LegalTemplate } from '../legal-template';
export default function SecurityDisclosure() {
  return (
    <LegalTemplate
      title="Security disclosure"
      items={[
        'Report vulnerabilities to [security contact].',
        'Do not access or alter user data.',
        '[Response timelines require confirmation].',
      ]}
    />
  );
}
