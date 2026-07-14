import Link from 'next/link';
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <nav className="nav">
        <Link className="brand" href="/">
          SENTRY
        </Link>
        <div className="navlinks">
          <Link href="/discover">Discover</Link>
          <Link href="/stock-tokens">Stock Tokens</Link>
          <Link href="/portfolio">Portfolio</Link>
          <Link href="/watchlists">Watchlists</Link>
          <Link href="/alerts">Alerts</Link>
          <Link href="/methodology">Methodology</Link>
        </div>
        <input
          className="search"
          aria-label="Search addresses, tokens, and wallets"
          placeholder="Search address or token"
        />
        <span className="badge">Chain status unavailable</span>
        <button aria-label="Connect wallet">Connect wallet</button>
      </nav>
      <div className="banner">
        Indexer status and live market data are unavailable. Values are not shown as zero.
      </div>
      <main className="main">{children}</main>
    </div>
  );
}
export function Unavailable({ label }: { label: string }) {
  return <span className="unavailable">{label}: unavailable</span>;
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
  return (
    <Shell>
      <h1>{title}</h1>
      {children}
    </Shell>
  );
}
