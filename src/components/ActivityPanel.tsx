'use client';

export type TimelineEvent = { id: number; actor: string; action: string; detail: unknown; createdAt: string | Date };

const ACTOR: Record<string, { label: string; tone: string }> = {
  agent: { label: 'Agent', tone: 'bg-sky-soft text-sky-ink' },
  owner: { label: 'Owner', tone: 'bg-leaf-soft text-leaf' },
  paypal: { label: 'PayPal', tone: 'bg-[#e6e1f5] text-[#4a3a8a]' },
};

const icon = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function ActorIcon({ actor }: { actor: string }) {
  if (actor === 'owner') {
    return (
      <svg {...icon} aria-hidden>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.200 1.900 7 5.500" />
      </svg>
    );
  }
  if (actor === 'paypal') {
    return (
      <svg {...icon} aria-hidden>
        <rect x="3" y="6" width="18" height="12" rx="2.5" />
        <path d="M3 10.500h18M7 15h3" />
      </svg>
    );
  }
  return (
    <svg {...icon} aria-hidden>
      <path d="M12 3.500l1.700 4.800 4.800 1.700-4.800 1.700L12 16.500l-1.700-4.800-4.800-1.700 4.800-1.700z" />
      <path d="M18.500 15.500l.7 1.800 1.800.7-1.800.7-.7 1.800-.7-1.800-1.800-.7 1.800-.7z" />
    </svg>
  );
}

function detailOf(e: TimelineEvent): Record<string, unknown> | null {
  return e.detail && typeof e.detail === 'object' ? (e.detail as Record<string, unknown>) : null;
}

/** A blocked action: a code-level guard stopped the agent. */
export function isGuardrailEvent(e: TimelineEvent): boolean {
  return detailOf(e)?.guardrail === true;
}

function shortTime(value: string | Date): string {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** The order's audit trail: who did what, in the order it happened. */
export function ActivityPanel({ events, live }: { events: TimelineEvent[]; live: boolean }) {
  return (
    <aside className="card p-4" aria-label="Agent activity">
      <h2 className="eyebrow flex items-center gap-2">
        Agent activity
        {live && <span className="live-dot h-1.5 w-1.5 rounded-full bg-sky-ink" />}
      </h2>
      <ol className="mt-3">
        {events.length === 0 && <li className="text-sm text-muted">Nothing yet.</li>}
        {events.map((e, i) => {
          const d = detailOf(e);
          const guardrail = isGuardrailEvent(e);
          const failed = !guardrail && typeof d?.error === 'string';
          // A held invoice is expected, not a problem: shown in neutral grey so only guardrails stand out.
          const held = !guardrail && d?.held === true;
          const actor = ACTOR[e.actor] ?? ACTOR.agent;
          const note = guardrail ? (d?.reason as string | undefined) : failed ? (d?.error as string) : undefined;
          return (
            <li key={e.id} className="event-in relative flex gap-2.5 pb-3.5 last:pb-0" data-actor={e.actor} data-guardrail={guardrail || undefined} data-held={held || undefined}>
              {i < events.length - 1 && <span className="absolute left-[11px] top-6 h-full w-px bg-rule" />}
              <span
                className={`relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${guardrail ? 'bg-brick-soft text-brick' : held ? 'bg-paper text-muted' : actor.tone}`}
                title={actor.label}
              >
                <ActorIcon actor={e.actor} />
              </span>
              <div className={`min-w-0 flex-1 ${guardrail ? 'rounded-lg border border-amber-rule bg-amber-soft px-2.5 py-1.5' : ''}`}>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {guardrail && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brick px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                      Guardrail
                    </span>
                  )}
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{actor.label}</span>
                  <time className="ml-auto shrink-0 text-[11px] tabular-nums text-muted" dateTime={new Date(e.createdAt).toISOString()}>
                    {shortTime(e.createdAt)}
                  </time>
                </p>
                <p className={`text-sm leading-snug ${guardrail ? 'font-semibold text-amber-ink' : failed ? 'font-medium text-brick' : held ? 'text-muted' : 'font-medium'}`}>{e.action}</p>
                {note && <p className={`mt-0.5 break-words text-xs ${guardrail ? 'text-amber-ink' : 'text-brick'}`}>{note}</p>}
                {d && (
                  <details className="mt-0.5">
                    <summary className="cursor-pointer text-xs text-muted hover:text-ink">details</summary>
                    <pre className="num mt-1 max-h-56 overflow-auto rounded-md bg-paper p-2 text-[11px] leading-snug">{JSON.stringify(d, null, 2)}</pre>
                  </details>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
