'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { NavLinks } from './nav-links';
import { SearchBox } from './search-box';
import { ThemeToggle } from './theme-toggle';
import { WalletConnect } from './wallet-connect';

/**
 * The primary navigation. On desktop it is an ordinary row — brand, links,
 * search, wallet, theme — because the `.nav-collapse` wrapper is `display:
 * contents` there, so its children lay out as if the wrapper were not present.
 *
 * At the table breakpoint (≤720px) the wrapper becomes a dropdown panel behind
 * a hamburger: the links and the wallet/theme controls move into it, while the
 * brand and search stay in the bar. The controls are the same component
 * instances in both layouts, so the wallet session is never mounted twice.
 */
export function SiteNav() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  // Close on Escape, and whenever the viewport grows back to the desktop layout
  // so a menu opened on a phone does not linger after a rotate or resize.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const desktop = window.matchMedia('(min-width: 721px)');
    const onChange = () => {
      if (desktop.matches) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    desktop.addEventListener('change', onChange);
    return () => {
      window.removeEventListener('keydown', onKey);
      desktop.removeEventListener('change', onChange);
    };
  }, [open]);

  return (
    <nav className={`nav ${open ? 'is-open' : ''}`} aria-label="Primary">
      <Link className="brand" href="/">
        SENTRY
      </Link>
      <SearchBox />
      <button
        type="button"
        className="nav-burger"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        aria-controls="nav-collapse"
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">{open ? '✕' : '☰'}</span>
      </button>
      {/* Clicking a nav link closes the menu; the wallet and theme controls,
          which are buttons rather than links, leave it open so they stay usable. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: closing is a convenience on link taps; keyboard users get Escape and the links themselves. */}
      <div
        id="nav-collapse"
        className="nav-collapse"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('a')) close();
        }}
      >
        <NavLinks />
        <div className="nav-controls">
          <WalletConnect />
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
