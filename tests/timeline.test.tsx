import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActivityPanel, isGuardrailEvent, type TimelineEvent } from '@/components/ActivityPanel';

const at = '2026-11-12T12:41:00.000Z';
const events: TimelineEvent[] = [
  { id: 1, actor: 'agent', action: 'Parsed by AI', detail: { lines: 2 }, createdAt: at },
  { id: 2, actor: 'agent', action: 'Send invoice blocked: waiting on owner approval', detail: { guardrail: true, reason: 'The owner has not approved this order, so nothing may be sent.', tool: 'send_invoice' }, createdAt: at },
  { id: 3, actor: 'owner', action: 'Owner approved', detail: null, createdAt: at },
  { id: 4, actor: 'paypal', action: 'Paid', detail: null, createdAt: at },
];
const heldEvent: TimelineEvent = { id: 5, actor: 'agent', action: 'Invoice held: waiting on owner approval', detail: { held: true, note: 'No invoice was created or sent.' }, createdAt: at };
const failedEvent: TimelineEvent = { id: 6, actor: 'agent', action: 'Invoicing failed', detail: { error: 'PayPal said no.' }, createdAt: at };

describe('Agent activity timeline', () => {
  const html = renderToStaticMarkup(<ActivityPanel events={events} live={false} />);
  const items = html.split('<li').slice(1);

  it('renders every event in order, with its actor', () => {
    expect(html).toContain('Agent activity');
    expect(items).toHaveLength(4);
    expect(items.map((li) => li.match(/data-actor="(\w+)"/)?.[1])).toEqual(['agent', 'agent', 'owner', 'paypal']);
    expect(items[2]).toContain('Owner approved');
    expect(items[3]).toContain('>PayPal<');
  });

  it('renders the blocked event as a Guardrail chip with its reason', () => {
    const blocked = items[1];
    expect(blocked).toContain('data-guardrail="true"');
    expect(blocked).toContain('Guardrail');
    expect(blocked).toContain('Send invoice blocked: waiting on owner approval');
    expect(blocked).toContain('The owner has not approved this order');
    expect(blocked).toContain('bg-brick'); // red chip
    expect(blocked).toContain('bg-amber-soft'); // amber card
  });

  it('does not mark ordinary events as guardrails', () => {
    for (const i of [0, 2, 3]) {
      expect(items[i]).not.toContain('Guardrail');
      expect(items[i]).not.toContain('data-guardrail');
    }
    expect(events.map(isGuardrailEvent)).toEqual([false, true, false, false]);
  });

  it('renders a held invoice in neutral grey, so only the guardrail stands out', () => {
    const [blocked, held] = renderToStaticMarkup(<ActivityPanel events={[events[1], heldEvent]} live={false} />)
      .split('<li')
      .slice(1);
    expect(held).toContain('data-held="true"');
    expect(held).toContain('Invoice held: waiting on owner approval');
    expect(held).toContain('text-muted');
    for (const loud of ['text-brick', 'bg-brick', 'bg-amber-soft', 'text-amber-ink', 'Guardrail']) expect(held).not.toContain(loud);
    expect(blocked).toContain('Guardrail');
    // A real failure still shows in red.
    expect(renderToStaticMarkup(<ActivityPanel events={[failedEvent]} live={false} />)).toContain('text-brick');
  });

  it('shows a short time on each event', () => {
    expect(items.every((li) => /<time[^>]*>\d{1,2}:\d{2}/.test(li))).toBe(true);
  });
});
