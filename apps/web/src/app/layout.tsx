import './globals.css';
import type { Metadata } from 'next';
import { Archivo, JetBrains_Mono } from 'next/font/google';

const sans = Archivo({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['400', '500', '600', '700', '800', '900'],
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
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
