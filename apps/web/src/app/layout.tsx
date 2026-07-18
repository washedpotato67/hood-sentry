import './globals.css';
import type { Metadata } from 'next';
import { Hanken_Grotesk, JetBrains_Mono } from 'next/font/google';
import { Shell } from './components';

// Body / normal text — warm, refined humanist sans, kept for data legibility.
const sans = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});
// Display / headlines use a condensed system stack (defined in globals.css),
// so no web font loads for the big brutalist type — it matches on every OS.
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
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        {/* Shell lives in the layout so the nav and footer render once and
            persist across navigations; only the page content below swaps. */}
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
