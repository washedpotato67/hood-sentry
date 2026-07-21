import Link from 'next/link';
import { ChainStatusBar } from './chain-status-bar';
import { SiteNav } from './site-nav';
import { StatusDot } from './status-dot';
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <SiteNav />
      <ChainStatusBar />
      <main className="main">{children}</main>
      <SiteFooter />
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Link className="brand" href="/">
            SENTRY
          </Link>
          <p className="muted">Evidence-based token intelligence for Robinhood Chain.</p>
        </div>
        <nav className="footer-cols" aria-label="Footer">
          <div className="footer-col">
            <h4>Research</h4>
            <Link href="/discover">Discover</Link>
            <Link href="/trade">Trade</Link>
            <Link href="/portfolio">Portfolio</Link>
            <Link href="/watchlists">Watchlists</Link>
            <Link href="/alerts">Alerts</Link>
          </div>
          <div className="footer-col">
            <h4>Intelligence</h4>
            <Link href="/projects">Projects</Link>
            <Link href="/reports">Reports</Link>
            <Link href="/methodology">Methodology</Link>
          </div>
          <div className="footer-col">
            <h4>Developers</h4>
            <Link href="/api">API</Link>
            <Link href="/api-terms">API terms</Link>
          </div>
          <div className="footer-col">
            <h4>Legal</h4>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/risk-disclosure">Risk disclosure</Link>
            <Link href="/acceptable-use">Acceptable use</Link>
          </div>
        </nav>
      </div>
      <div className="footer-bottom">
        <span className="muted">© {new Date().getFullYear()} Hood Sentry</span>
        <StatusDot />
        <span className="muted">Evidence, not guarantees. Not financial advice.</span>
      </div>
    </footer>
  );
}
export function Unavailable({ label }: { label: string }) {
  return <span className="unavailable">{label}: unavailable</span>;
}

// A named, purposeful empty state: says what's absent and what to do next,
// instead of a bare line of gray text in a large box.
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-mark" aria-hidden="true" />
      <p className="empty-title">{title}</p>
      <p className="empty-body">{children}</p>
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}
export function Stat({ label, value }: { label: string; value?: string }) {
  return (
    <div className="panel">
      <div className="muted">{label}</div>
      <div>{value ?? <Unavailable label={label} />}</div>
    </div>
  );
}
export function Page({ title, children }: { title: string; children: React.ReactNode }) {
  // The shell is provided by the root layout; a page only supplies its content.
  return (
    <>
      <h1>{title}</h1>
      {children}
    </>
  );
}

export function ErrorPanel({ code, message }: { code: string; message: string }) {
  return (
    <section className="panel error-panel">
      <strong>{code}</strong>
      <p>{message}</p>
    </section>
  );
}
