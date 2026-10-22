import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Taprizz', template: '%s · Taprizz' },
  description: 'Scan, order and pay at your table.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#fafaf9' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading request headers opts every page into per-request rendering. That is REQUIRED: the CSP nonce is
  // created per request in middleware, and a statically pre-built page could not carry it (its scripts would
  // be blocked by the browser). tests/http/headers.test.ts guards this.
  await headers();
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
