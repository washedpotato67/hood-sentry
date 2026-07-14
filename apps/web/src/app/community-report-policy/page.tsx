import { LegalTemplate } from '../legal-template';
export default function CommunityPolicy() {
  return (
    <LegalTemplate
      title="Community report policy"
      items={[
        'Reports are allegations until resolved.',
        'Evidence and moderation history are retained under [retention policy].',
        'Appeals follow [appeal process].',
      ]}
    />
  );
}
