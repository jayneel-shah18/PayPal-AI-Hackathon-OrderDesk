import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'OrderDesk',
  description: 'Paste a messy customer order. For small distributors: An AI agent turns it into a priced PayPal invoice you approve and send in one tap.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-rule bg-card">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="font-display text-2xl font-semibold tracking-tight">OrderDesk</span>
              <span className="hidden text-xs text-muted sm:inline">messy order in, PayPal invoice out</span>
            </Link>
            <nav className="ml-auto flex items-center gap-1 text-sm">
              <Link href="/" className="rounded-md px-3 py-1.5 hover:bg-paper">
                New order
              </Link>
              <Link href="/orders" className="rounded-md px-3 py-1.5 hover:bg-paper">
                Orders
              </Link>
              <span className="ml-2 rounded-full border border-amber-rule bg-amber-soft px-2.5 py-0.5 text-xs font-medium text-amber-ink">
                PayPal sandbox
              </span>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
