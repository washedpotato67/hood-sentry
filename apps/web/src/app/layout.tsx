import './globals.css';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Hood Sentry', template: '%s | Hood Sentry' },
  description: 'Evidence-based security and intelligence for Robinhood Chain.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
