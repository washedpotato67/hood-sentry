import Link from 'next/link';

// App Router 404. Its presence also lets `next build` generate the not-found
// route through the App Router instead of falling back to the pages-router
// error page (which imports <Html> and breaks the production build).
export default function NotFound() {
  return (
    <section className="notice">
      <p className="notice-code">Error 404</p>
      <h1>This page left no evidence.</h1>
      <p className="lede">
        The address you followed isn't indexed here. It may have moved, or never existed. Head back
        and start from discovery.
      </p>
      <div className="actions">
        <Link className="primary" href="/">
          Return to Sentry →
        </Link>
        <Link href="/discover">Open discovery</Link>
      </div>
    </section>
  );
}
