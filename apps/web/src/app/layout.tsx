import './globals.css';
import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Shell } from './components';

// Body / normal text — Inter, the terminal-register workhorse, kept for data
// legibility. Headlines share it at heavier weights and tighter tracking.
const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
});
// Mono — addresses, labels, and readouts. The instrument's secondary voice.
const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
});

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Hood Sentry', template: '%s | Hood Sentry' },
  description: 'Evidence-based security and intelligence for Robinhood Chain.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        {/* Re-apply a pinned theme before paint so there's no flash. Dark is the
            default when nothing is stored (CSS handles OS light preference).
            Authorized by its SHA-256 hash in the CSP (middleware.ts) rather than
            a per-request nonce, which would differ between the HTML document and
            its dev-mode RSC payload. */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: tiny inline no-flash theme script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t;}catch(e){}",
          }}
        />
        {/* Shell lives in the layout so the nav and footer render once and
            persist across navigations; only the page content below swaps. */}
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
