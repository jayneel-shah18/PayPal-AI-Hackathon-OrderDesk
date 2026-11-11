'use client';

type Event = { id: number; kind: string; label: string; detail: unknown; createdAt: string };

const DOT: Record<string, string> = {
  step: 'bg-ink',
  tool_call: 'bg-sky-ink',
  webhook: 'bg-leaf',
  error: 'bg-brick',
};

function summary(e: Event): string | null {
  const d = e.detail as { input?: { query?: string; invoice_id?: string }; output?: unknown; error?: string; payer_link?: string } | null;
  if (!d) return null;
  if (d.error) return d.error;
  if (d.input?.query) return `"${d.input.query}" → ${Array.isArray(d.output) && d.output.length ? (d.output as string[]).slice(0, 3).join(', ') : 'no match'}`;
  if (d.input?.invoice_id) return d.input.invoice_id;
  return null;
}

/** Every agent step and tool call for this order, in the order it happened. */
export function ActivityPanel({ events, live }: { events: Event[]; live: boolean }) {
  return (
    <aside className="lg:sticky lg:top-4 lg:self-start">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
        Agent activity
        {live && <span className="live-dot h-1.5 w-1.5 rounded-full bg-sky-ink" />}
      </h2>
      <ol className="mt-2 rounded-xl border border-rule bg-card p-3">
        {events.length === 0 && <li className="text-sm text-muted">Nothing yet.</li>}
        {events.map((e, i) => {
          const s = summary(e);
          return (
            <li key={e.id} className="event-in relative flex gap-3 pb-3 last:pb-0">
              {i < events.length - 1 && <span className="absolute left-[5px] top-4 h-full w-px bg-rule" />}
              <span className={`relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full ${DOT[e.kind] ?? 'bg-muted'}`} />
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${e.kind === 'tool_call' || e.kind === 'error' ? 'num text-[13px]' : 'font-medium'} ${e.kind === 'error' ? 'text-brick' : ''}`}>
                  {e.label}
                </p>
                {s && <p className="break-words text-xs text-muted">{s}</p>}
                {e.detail != null && (
                  <details className="mt-0.5">
                    <summary className="cursor-pointer text-xs text-muted hover:text-ink">details</summary>
                    <pre className="num mt-1 max-h-56 overflow-auto rounded-md bg-paper p-2 text-[11px] leading-snug">{JSON.stringify(e.detail, null, 2)}</pre>
                  </details>
                )}
              </div>
              <time className="num shrink-0 text-[11px] text-muted" dateTime={e.createdAt}>
                {new Date(e.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </time>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
