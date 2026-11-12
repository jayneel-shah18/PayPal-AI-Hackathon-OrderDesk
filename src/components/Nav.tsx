'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogoMark, PlusIcon } from './Icons';
import { ResetDemo } from './ResetDemo';

const LINKS = [
  { href: '/', label: 'Inbox', active: (p: string) => p === '/' },
  { href: '/orders', label: 'Orders', active: (p: string) => p === '/orders' },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-rule bg-card/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-5">
        <Link href="/" className="flex items-center gap-2.5">
          <LogoMark />
          <span className="hidden font-display text-xl font-semibold tracking-tight min-[430px]:inline">OrderDesk</span>
        </Link>
        <nav className="ml-1 flex items-center gap-1 text-sm sm:ml-4" aria-label="Main">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={l.active(path) ? 'page' : undefined}
              className={`rounded-md px-2.5 py-1.5 font-medium transition sm:px-3 ${l.active(path) ? 'bg-leaf-soft text-leaf' : 'text-muted hover:bg-paper hover:text-ink'}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <span className="ml-auto" />
        <ResetDemo />
        <Link href="/new" className="btn" aria-label="New order">
          <PlusIcon />
          <span className="sm:hidden">New</span>
          <span className="hidden sm:inline">New order</span>
        </Link>
      </div>
    </header>
  );
}
