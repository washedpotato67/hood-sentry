// Rendered in the content area while a navigation's server render is pending.
// The persistent shell (nav, footer) stays; only this area shows the skeleton,
// so switching sections gives instant feedback instead of a blank pause.
export default function Loading() {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-line" style={{ width: '70%' }} />
      <div className="skeleton skeleton-panel" />
      <div className="skeleton skeleton-panel" />
    </div>
  );
}
