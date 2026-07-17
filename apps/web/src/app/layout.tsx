import './globals.css';
import type { Metadata } from 'next';
import { Archivo, Hanken_Grotesk, JetBrains_Mono } from 'next/font/google';
import { Shell } from './components';

// Body / normal text — warm, refined humanist sans.
const sans = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});
// Display / headlines — industrial grotesk, for contrast against the body.
const display = Archivo({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['600', '700', '800', '900'],
  display: 'swap',
});
const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500', '600'],
  display: 'swap',
});

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Hood Sentry', template: '%s | Hood Sentry' },
  description: 'Evidence-based security and intelligence for Robinhood Chain.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable}`}>
      <body>
        {/* Shell lives in the layout so the nav and footer render once and
            persist across navigations; only the page content below swaps. */}
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
