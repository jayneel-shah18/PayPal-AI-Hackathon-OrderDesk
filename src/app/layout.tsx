import type { Metadata } from 'next';
import { Nav } from '@/components/Nav';
import './globals.css';

export const metadata: Metadata = {
  title: 'OrderDesk',
  description: 'For small distributors: customer orders come in messy, priced PayPal invoices go out. You approve every one.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <Nav />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">{children}</main>
        <footer className="mx-auto w-full max-w-6xl px-4 pb-6 text-xs text-muted">
          <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-rule align-middle" />
          Connected to the PayPal sandbox. No real money moves.
        </footer>
      </body>
    </html>
  );
}
