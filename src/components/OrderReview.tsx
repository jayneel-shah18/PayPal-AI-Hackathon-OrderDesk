'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Meta } from '@/lib/client';
import type { OrderDetail } from '@/lib/orders';
import { formatUsd, MODEL_FLAGS, type ParsedLine } from '@/lib/schema';
import { CHANNEL_LABEL, channelOf } from '@/lib/inbox';
import { ActivityPanel, type TimelineEvent } from './ActivityPanel';
import { applyQuantityEdit } from '@/lib/totals';
import { ChannelIcon } from './Icons';
import { LinesGrid } from './LinesGrid';
import { StatusChip } from './StatusChip';

type Order = Omit<OrderDetail, 'createdAt' | 'updatedAt' | 'events'> & {
  createdAt: string;
  events: TimelineEvent[];
};

const FLAG_LABEL: Record<string, string> = {
  ambiguous: 'Question for the customer',
  not_in_catalog: 'Not something we carry',
  needs_history: 'Check their last order',
  out_of_stock: 'Short on stock',
};

const EDITABLE = ['draft', 'needs_info', 'failed'];

export function OrderReview({ id }: { id: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    if (savingRef.current) return;
    try {
      const { order } = await api<{ order: Order }>(`/api/orders/${id}`);
      if (!savingRef.current) setOrder(order);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    load();
    api<Meta>('/api/meta').then(setMeta).catch(() => {});
  }, [load]);

  // Poll fast while an agent is working, slowly while waiting for payment (the webhook flips it to Paid).
  const status = order?.status;
  useEffect(() => {
    const ms = status === 'parsing' || status === 'sending' ? 1000 : status === 'invoiced' ? 4000 : 0;
    if (!ms) return;
    const t = setInterval(load, ms);
    return () => clearInterval(t);
  }, [status, load]);

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setError(null);
    setNotice(null);
    setSaving(true);
    savingRef.current = true;
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function patch(body: Record<string, unknown>) {
    const res = await run(() => api<{ order: Order }>(`/api/orders/${id}`, { method: 'PATCH', body }));
    if (res) setOrder(res.order);
  }

  /** Save all lines. `touched` is the line the owner just changed: its model flags are cleared. */
  function saveLines(lines: ParsedLine[], touched?: number) {
    return patch({
      lines: lines.map((l, i) => ({
        raw_text: l.raw_text,
        sku: l.sku,
        qty: l.qty,
        flags: i === touched ? [] : l.flags.filter((f) => (MODEL_FLAGS as readonly string[]).includes(f)),
        flag_reason: i === touched ? null : l.flags.some((f) => (MODEL_FLAGS as readonly string[]).includes(f)) ? l.flag_reason : null,
        candidate_skus: l.candidates.map((c) => c.sku),
      })),
    });
  }

  if (!order) return <p className="text-sm text-muted">{error ?? 'Loading order…'}</p>;

  const editable = EDITABLE.includes(order.status);
  const working = order.status === 'parsing' || order.status === 'sending';
  const lines = order.lines;
  const setLine = (i: number, change: Partial<ParsedLine>) =>
    saveLines(
      lines.map((l, j) => (j === i ? { ...l, ...change } : l)),
      i,
    );
  const stockOf = (sku: string | null) => meta?.catalog.find((c) => c.sku === sku)?.stock;
  /** Change one line's quantity: totals update at once, then the server re-prices and saves. */
  const setQty = (i: number, qty: number | null) => {
    const next = applyQuantityEdit(lines, i, qty);
    setOrder({ ...order, lines: next.lines, totalCents: next.totalCents });
    return saveLines(next.lines, i);
  };
  const flagBlock = (l: ParsedLine, i: number) => {
    const stock = stockOf(l.sku);
    return (
      <div className="mt-2 rounded-lg border border-amber-rule bg-white/60 px-3 py-2 text-amber-ink">
        <p className="text-xs font-semibold">{l.flags.map((f) => FLAG_LABEL[f] ?? f).join(' · ')}</p>
        {l.flag_reason && <p className="mt-0.5 text-sm">{l.flag_reason}</p>}
        {editable && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {!l.sku &&
              l.candidates.map((c) => (
                <button key={c.sku} className="btn !whitespace-normal !py-1 !text-left !text-xs" disabled={saving} onClick={() => setLine(i, { sku: c.sku })}>
                  {c.name}
                </button>
              ))}
            {l.flags.includes('out_of_stock') && stock != null && stock > 0 && (
              <button className="btn !py-1 !text-xs" disabled={saving} onClick={() => setQty(i, stock)}>
                Send {stock} now
              </button>
            )}
            {l.sku && l.qty && !l.flags.includes('out_of_stock') && (
              <button className="btn !py-1 !text-xs" disabled={saving} onClick={() => setLine(i, {})}>
                Looks right
              </button>
            )}
          </div>
        )}
      </div>
    );
  };
  const channel = channelOf(order.source, order.rawText);
  const customer = order.recipientName ?? order.customerHint;
  const received = new Date(order.createdAt);
  const flaggedCount = lines.filter((l) => l.flags.length > 0).length;

  return (
    <div>
      <Link href="/" className="text-sm text-muted hover:text-ink">
        ← Inbox
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="font-display text-3xl font-semibold">{customer ? `Order from ${customer}` : 'New order'}</h1>
        <StatusChip status={order.status} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[21rem_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:items-start">
        {/* Left: what the customer sent */}
        <section className="card p-4 lg:col-start-1 lg:row-start-1" aria-label="Original message">
          <div className="flex items-center gap-2 text-xs text-muted">
            <ChannelIcon channel={channel} />
            <span className="font-medium">{CHANNEL_LABEL[channel]}</span>
            <time className="ml-auto tabular-nums" dateTime={order.createdAt}>
              {received.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </time>
          </div>
          <blockquote className="mt-3 whitespace-pre-wrap break-words rounded-2xl rounded-tl-sm bg-paper px-4 py-3 text-[15px] leading-relaxed">
            {order.source === 'photo' ? 'Photo of a handwritten order' : order.rawText}
          </blockquote>
          {order.deliveryNote && (
            <p className="mt-3 text-sm">
              <span className="eyebrow mr-2">Delivery</span>
              {order.deliveryNote}
            </p>
          )}
        </section>

        {/* Right: the order as it will be invoiced */}
        <section className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {order.status === 'parsing' ? (
            <div className="card flex items-center gap-3 p-6 text-sm text-muted">
              <span className="live-dot h-2 w-2 rounded-full bg-sky-ink" /> Reading the order and looking up your catalog…
            </div>
          ) : (
            <>
              <div className="card overflow-hidden">
                <div className="flex items-baseline gap-3 border-b border-rule px-4 py-3">
                  <h2 className="text-base font-semibold">Order lines</h2>
                  {flaggedCount > 0 && (
                    <span className="text-sm text-amber-ink">
                      {flaggedCount} need{flaggedCount === 1 ? 's' : ''} your attention
                    </span>
                  )}
                </div>
                {/* Laptop and up: AG Grid with editable quantity. Phone: the stacked list below. */}
                <div className="hidden sm:block">
                  <LinesGrid
                    lines={lines}
                    totalCents={order.totalCents}
                    catalog={meta?.catalog ?? []}
                    editable={editable && !saving}
                    onQty={setQty}
                    onSku={(i, sku) => setLine(i, { sku })}
                    onRemove={(i) => saveLines(lines.filter((_, j) => j !== i))}
                  />
                  {flaggedCount > 0 && (
                    <ul className="space-y-2 border-t border-rule bg-amber-soft px-4 py-3">
                      {lines.map((l, i) =>
                        l.flags.length > 0 ? (
                          <li key={i}>
                            <p className="text-xs text-amber-ink">
                              Line {i + 1}: “{l.raw_text}”
                            </p>
                            {flagBlock(l, i)}
                          </li>
                        ) : null,
                      )}
                    </ul>
                  )}
                </div>
                <ul className="divide-y divide-rule sm:hidden">
                  {lines.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">No lines yet. Add one below.</li>}
                  {lines.map((l, i) => {
                    const flagged = l.flags.length > 0;
                    const stock = stockOf(l.sku);
                    return (
                      <li key={i} className={`px-4 py-3 ${flagged ? 'bg-amber-soft' : ''}`}>
                        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                          <div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
                            <select
                              className="field"
                              disabled={!editable || saving}
                              value={l.sku ?? ''}
                              onChange={(e) => setLine(i, { sku: e.target.value || null })}
                              aria-label={`Product for line ${i + 1}`}
                            >
                              <option value="">Choose a product…</option>
                              {(meta?.catalog ?? (l.sku ? [{ sku: l.sku, name: l.name ?? l.sku }] : [])).map((c) => (
                                <option key={c.sku} value={c.sku}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                            <p className="mt-1 text-xs text-muted">
                              Customer wrote “{l.raw_text}”{l.sku && <span className="num"> · {l.sku}</span>}
                            </p>
                          </div>
                          <div className="w-20">
                            <QtyInput value={l.qty} disabled={!editable || saving} onCommit={(qty) => setQty(i, qty)} label={`Quantity for line ${i + 1}`} />
                            {l.unit && <p className="mt-1 text-xs text-muted">{/(x|s|ch)$/.test(l.unit) ? `${l.unit}es` : `${l.unit}s`}</p>}
                          </div>
                          <div className="num w-20 pt-1.5 text-right text-sm text-muted">
                            {formatUsd(l.unit_price_cents)}
                            <span className="block text-[11px] sm:hidden">each</span>
                          </div>
                          <div className="num ml-auto w-24 pt-1.5 text-right text-sm font-semibold sm:ml-0">{formatUsd(l.line_total_cents)}</div>
                          <div className="w-6 pt-1 text-right">
                            {editable && (
                              <button
                                className="rounded p-1 text-muted hover:bg-brick-soft hover:text-brick"
                                disabled={saving}
                                onClick={() => saveLines(lines.filter((_, j) => j !== i))}
                                aria-label={`Remove line ${i + 1}`}
                                title="Remove line"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        </div>
                        {flagged && flagBlock(l, i)}
                      </li>
                    );
                  })}
                </ul>
                <div className={`flex items-center gap-3 border-t border-rule bg-paper/50 px-4 py-3 ${editable ? "" : "sm:hidden"}`}>
                  {editable && (
                    <button
                      className="btn !py-1 !text-xs"
                      disabled={saving}
                      onClick={() =>
                        saveLines([
                          ...lines,
                          { raw_text: 'Added by owner', sku: null, name: null, unit: null, qty: 1, unit_price_cents: null, line_total_cents: null, confidence: 1, flags: [], flag_reason: null, candidates: [] },
                        ])
                      }
                    >
                      + Add line
                    </button>
                  )}
                  <span className="eyebrow ml-auto sm:hidden">Invoice total</span>
                  <span className="num text-xl font-semibold sm:hidden">{formatUsd(order.totalCents)}</span>
                </div>
              </div>

              <div className="card mt-4 grid gap-3 p-4 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="eyebrow mb-1 block">Bill to</span>
                  <select className="field" disabled={!editable || saving} value={order.customerId ?? ''} onChange={(e) => patch({ customerId: e.target.value || null })}>
                    <option value="">{order.customerHint ? `"${order.customerHint}" (pick a customer)` : 'Pick a customer…'}</option>
                    {(meta?.customers ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="eyebrow mb-1 block">Invoice goes to</span>
                  <EmailInput value={order.recipientEmail ?? ''} disabled={!editable || saving} onCommit={(recipientEmail) => patch({ recipientEmail })} />
                </label>
              </div>

              {editable && (
                <div className="card mt-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <p className="min-w-0 flex-1 text-sm text-muted">
                    {order.blocker ?? (
                      <>
                        Sends a PayPal invoice for <span className="num font-semibold text-ink">{formatUsd(order.totalCents)}</span> to {order.recipientEmail}.
                      </>
                    )}
                  </p>
                  <button
                    className="btn btn-primary w-full !px-6 !py-3 !text-base sm:w-auto"
                    disabled={saving || !!order.blocker}
                    onClick={async () => {
                      const res = await run(() => api(`/api/orders/${id}/approve`, { method: 'POST' }));
                      if (res) setOrder({ ...order, status: 'sending' });
                    }}
                  >
                    Approve and send invoice
                  </button>
                </div>
              )}

              {order.status === 'sending' && (
                <div className="card mt-4 flex items-center gap-3 p-4 text-sm text-muted">
                  <span className="live-dot h-2 w-2 rounded-full bg-sky-ink" /> Creating and sending the PayPal invoice…
                </div>
              )}

              {order.status === 'paid' && (
                <p className="mt-4 rounded-xl bg-leaf-soft px-4 py-3 text-sm font-medium text-leaf">Paid through PayPal. Nothing left to chase.</p>
              )}
              {order.status === 'failed' && order.error && (
                <p className="mt-4 rounded-xl bg-brick-soft px-4 py-3 text-sm text-brick">
                  {order.error} {order.invoiceId ? 'An invoice exists in PayPal for this order; use Refresh status.' : 'Fix the order or try again.'}
                </p>
              )}

              {order.invoiceId && !working && (
                <div className="card mt-4 p-4">
                  <p className="text-sm">
                    Invoice <span className="num font-semibold">{order.invoiceNumber ?? order.invoiceId}</span>
                    {order.recipientEmail && <span className="text-muted"> · sent to {order.recipientEmail}</span>}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {order.invoiceUrl && (
                      <a className="btn btn-primary" href={order.invoiceUrl} target="_blank" rel="noreferrer">
                        Open payer link ↗
                      </a>
                    )}
                    <button
                      className="btn"
                      disabled={saving}
                      onClick={async () => {
                        const res = await run(() => api<{ order: Order }>(`/api/orders/${id}/refresh`, { method: 'POST' }));
                        if (res) setOrder(res.order);
                      }}
                    >
                      Refresh status
                    </button>
                    {order.status === 'invoiced' && (
                      <>
                        <button
                          className="btn"
                          disabled={saving}
                          onClick={async () => {
                            const res = await run(() => api(`/api/orders/${id}/remind`, { method: 'POST' }));
                            if (res) {
                              setNotice('Reminder sent.');
                              load();
                            }
                          }}
                        >
                          Send reminder
                        </button>
                        <button
                          className="btn"
                          disabled={saving}
                          onClick={async () => {
                            const res = await run(() => api<{ image: string }>(`/api/orders/${id}/qr`, { method: 'POST' }));
                            if (res) setQr(res.image);
                          }}
                        >
                          QR code for counter
                        </button>
                      </>
                    )}
                  </div>
                  {qr && (
                    <figure className="mt-4 inline-block rounded-xl border border-rule bg-white p-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={qr} alt="PayPal invoice QR code" width={220} height={220} />
                      <figcaption className="mt-1 text-center text-xs text-muted">Scan to pay at the counter</figcaption>
                    </figure>
                  )}
                </div>
              )}
            </>
          )}
          {notice && <p className="mt-3 text-sm text-leaf">{notice}</p>}
          {error && <p className="mt-3 rounded-lg bg-brick-soft px-3 py-2 text-sm text-brick">{error}</p>}
        </section>

        <div className="lg:col-start-1 lg:row-start-2">
          <ActivityPanel events={order.events} live={working} />
        </div>
      </div>
    </div>
  );
}

function QtyInput({ value, disabled, onCommit, label }: { value: number | null; disabled: boolean; onCommit: (v: number | null) => void; label: string }) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  useEffect(() => setDraft(value == null ? '' : String(value)), [value]);
  const commit = () => {
    const n = draft.trim() === '' ? null : Number(draft);
    const next = n != null && Number.isInteger(n) && n > 0 ? n : null;
    if (next !== value) onCommit(next);
    else setDraft(value == null ? '' : String(value));
  };
  return (
    <input
      className="field num"
      inputMode="numeric"
      placeholder="?"
      aria-label={label}
      disabled={disabled}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function EmailInput({ value, disabled, onCommit }: { value: string; disabled: boolean; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className="field"
      type="email"
      placeholder="buyer@example.com"
      disabled={disabled}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() !== value && onCommit(draft.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}
