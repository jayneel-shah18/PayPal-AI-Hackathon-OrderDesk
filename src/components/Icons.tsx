import type { Channel } from '@/lib/inbox';

const base = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function ChannelIcon({ channel, className }: { channel: Channel; className?: string }) {
  if (channel === 'email') {
    return (
      <svg {...base} className={className} aria-hidden>
        <rect x="3" y="5" width="18" height="14" rx="2.5" />
        <path d="m4 7.5 8 6 8-6" />
      </svg>
    );
  }
  if (channel === 'photo') {
    return (
      <svg {...base} className={className} aria-hidden>
        <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1.2-2h6.2l1.2 2h1.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.500 19h-11A2.500 2.500 0 0 1 4 16.500z" />
        <circle cx="12" cy="12.500" r="3.200" />
      </svg>
    );
  }
  return (
    <svg {...base} className={className} aria-hidden>
      <path d="M20 12.500a7.500 7.500 0 0 1-11.300 6.460L4 20l1.100-4.300A7.500 7.500 0 1 1 20 12.500z" />
    </svg>
  );
}

export function PlusIcon({ className }: { className?: string }) {
  return (
    <svg {...base} strokeWidth={2.2} className={className} aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function LogoMark() {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-leaf text-white" aria-hidden>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
        <path d="M9.500 8.500h5M9.500 12.500h5" />
      </svg>
    </span>
  );
}
