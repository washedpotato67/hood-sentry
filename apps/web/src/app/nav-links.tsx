'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/discover', label: 'Discover' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/watchlists', label: 'Watchlists' },
  { href: '/alerts', label: 'Alerts' },
  { href: '/projects', label: 'Projects' },
  { href: '/reports', label: 'Reports' },
  { href: '/trade', label: 'Trade' },
] as const;

export function NavLinks() {
  const pathname = usePathname();
  return (
    <div className="navlinks">
      {LINKS.map(({ href, label }) => {
        // Detail routes (/token/0x…, /reports/42) keep their section marked.
        const current = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} aria-current={current ? 'page' : undefined}>
            {label}
          </Link>
        );
      })}
    </div>
  );
}
