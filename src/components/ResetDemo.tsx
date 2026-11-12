'use client';

import { useEffect, useRef, useState } from 'react';
import { api, type Meta } from '@/lib/client';

/** Header button that puts the demo back to its starting state. Shown only when DEMO_MODE is on. */
export function ResetDemo() {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    api<Meta>('/api/meta')
      .then((m) => setEnabled(m.config.demoMode))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy]);

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      await api('/demo/reset', { method: 'POST' });
      window.location.assign('/'); // back to a freshly loaded inbox
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (!enabled) return null;

  return (
    <>
      <button className="btn !border-transparent !bg-transparent !px-2 text-muted hover:!border-rule hover:text-ink sm:!px-3" title="Reset demo" onClick={() => setOpen(true)}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 12a8 8 0 1 0 2.600-5.900" />
          <path d="M4 4.500v4h4" />
        </svg>
        <span className="hidden sm:inline">Reset demo</span>
        <span className="sr-only sm:hidden">Reset demo</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center" onClick={() => !busy && setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="reset-title" className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h2 id="reset-title" className="font-display text-xl font-semibold">
              Reset the demo?
            </h2>
            <p className="mt-2 text-sm text-muted">
              This deletes every order here, with its lines and activity history, and puts the sample orders back so the inbox messages show as New again.
            </p>
            <p className="mt-2 text-sm text-muted">It does not contact PayPal. Invoices already created in the PayPal sandbox stay as they are.</p>
            {error && <p className="mt-3 rounded-lg bg-brick-soft px-3 py-2 text-sm text-brick">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button ref={cancelRef} className="btn" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="btn !border-brick !bg-brick text-white hover:!bg-[#8a2a18]" disabled={busy} onClick={reset}>
                {busy ? 'Resetting…' : 'Reset demo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
