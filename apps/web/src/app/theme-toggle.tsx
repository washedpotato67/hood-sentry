'use client';

import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

// Dark is the committed default. This lets a viewer pin the other skin; the
// choice persists to localStorage and is re-applied before paint by the inline
// script in layout.tsx, so there's no flash on the next load.
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const stored = document.documentElement.dataset.theme as Theme | undefined;
    const resolved =
      stored ?? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    setTheme(resolved);
  }, []);

  function toggle() {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      // storage may be unavailable (private mode); the in-page switch still works
    }
    setTheme(next);
  }

  // `theme` is null until mounted, matching the server render to avoid a
  // hydration mismatch; the label fills in once we know the active theme.
  const nextLabel = theme === 'light' ? 'Dark' : 'Light';
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={theme ? `Switch to ${nextLabel.toLowerCase()} theme` : 'Toggle theme'}
    >
      <span aria-hidden="true">◐</span>
      {theme ? ` ${nextLabel}` : ''}
    </button>
  );
}
