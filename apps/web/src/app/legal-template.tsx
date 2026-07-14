import { Page } from './components';
export function LegalTemplate({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <Page title={title}>
      <div className="panel">
        <p className="unavailable">
          Legal review required. Replace bracketed placeholders before publication.
        </p>
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>[Legal entity], [jurisdiction], and [support contact] require confirmation.</p>
      </div>
    </Page>
  );
}
