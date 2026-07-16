import Link from 'next/link';
import { ChainStatus } from './chain-status';
import { SearchBox } from './search-box';
import { WalletConnect } from './wallet-connect';
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <nav className="nav">
        <Link className="brand" href="/">
          SENTRY
        </Link>
        <div className="navlinks">
          <Link href="/discover">Discover</Link>
          <Link href="/portfolio">Portfolio</Link>
          <Link href="/watchlists">Watchlists</Link>
          <Link href="/alerts">Alerts</Link>
          <Link href="/projects">Projects</Link>
          <Link href="/reports">Reports</Link>
          <Link href="/trade">Trade</Link>
          <Link href="/api">API</Link>
          <Link href="/admin">Admin</Link>
          <Link href="/methodology">Methodology</Link>
        </div>
        <SearchBox />
        <ChainStatus />
        <WalletConnect />
      </nav>
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

export function ErrorPanel({ code, message }: { code: string; message: string }) {
  return (
    <section className="panel error-panel">
      <strong>{code}</strong>
      <p>{message}</p>
    </section>
  );
}
