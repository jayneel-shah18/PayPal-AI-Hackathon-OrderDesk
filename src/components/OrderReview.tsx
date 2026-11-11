'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Meta } from '@/lib/client';
import type { OrderDetail } from '@/lib/orders';
import { formatUsd, MODEL_FLAGS, type ParsedLine } from '@/lib/schema';
import { ActivityPanel } from './ActivityPanel';
import { StatusChip } from './StatusChip';

type Order = Omit<OrderDetail, 'createdAt' | 'updatedAt' | 'events'> & {
  createdAt: string;
  events: { id: number; kind: string; label: string; detail: unknown; createdAt: string }[];
};

const FLAG_LABEL: Record<string, string> = {
  ambiguous: 'Unclear',
  not_in_catalog: 'Not in catalog',
  needs_history: 'Needs order history',
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

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <section className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-semibold">Review order</h1>
          <StatusChip status={order.status} />
          <span className="num text-xs text-muted">{order.id}</span>
        </div>

        <figure className="mt-4 rounded-xl border border-rule bg-card p-4">
          <figcaption className="text-xs font-semibold uppercase tracking-wider text-muted">
            {order.source === 'photo' ? 'From a photo' : 'Original message'}
          </figcaption>
          <blockquote className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed">{order.rawText}</blockquote>
          {order.deliveryNote && (
            <p className="mt-2 text-sm">
              <span className="font-medium">Delivery:</span> {order.deliveryNote}
            </p>
          )}
        </figure>

        {order.status === 'parsing' ? (
          <p className="mt-6 flex items-center gap-2 text-sm text-muted">
            <span className="live-dot h-2 w-2 rounded-full bg-sky-ink" /> The agent is reading the order and looking up the catalog…
          </p>
        ) : (
          <>
            <div className="mt-4 overflow-x-auto rounded-xl border border-rule bg-card">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b border-rule text-left text-xs uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Product</th>
                    <th className="w-24 px-3 py-2 font-semibold">Qty</th>
                    <th className="w-24 px-3 py-2 text-right font-semibold">Unit price</th>
                    <th className="w-28 px-3 py-2 text-right font-semibold">Line total</th>
                    <th className="w-10 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-muted">
                        No lines. Add one below.
                      </td>
                    </tr>
                  )}
                  {lines.map((l, i) => {
                    const flagged = l.flags.length > 0;
                    const stock = stockOf(l.sku);
                    return (
                      <tr key={i} className={`border-b border-rule last:border-0 align-top ${flagged ? 'bg-amber-soft' : ''}`}>
                        <td className="px-3 py-2">
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
                                {c.name} · {c.sku}
                              </option>
                            ))}
                          </select>
                          <p className="mt-1 text-xs text-muted">
                            “{l.raw_text}”{!flagged && l.confidence < 1 && <span> · {Math.round(l.confidence * 100)}% sure</span>}
                          </p>
                          {flagged && (
                            <div className="mt-2 border-l-2 border-amber-rule pl-2 text-amber-ink">
                              <p className="text-xs font-semibold">{l.flags.map((f) => FLAG_LABEL[f] ?? f).join(' · ')}</p>
                              {l.flag_reason && <p className="text-xs">{l.flag_reason}</p>}
                              {editable && (
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                  {!l.sku &&
                                    l.candidates.map((c) => (
                                      <button key={c.sku} className="btn !py-1 !text-xs" disabled={saving} onClick={() => setLine(i, { sku: c.sku })}>
                                        {c.name}
                                      </button>
                                    ))}
                                  {l.flags.includes('out_of_stock') && stock != null && stock > 0 && (
                                    <button className="btn !py-1 !text-xs" disabled={saving} onClick={() => setLine(i, { qty: stock })}>
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
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <QtyInput value={l.qty} disabled={!editable || saving} onCommit={(qty) => setLine(i, { qty })} label={`Quantity for line ${i + 1}`} />
                          {l.unit && <p className="mt-1 text-xs text-muted">{/(x|s|ch)$/.test(l.unit) ? `${l.unit}es` : `${l.unit}s`}</p>}
                        </td>
                        <td className="num px-3 py-2.5 text-right">{formatUsd(l.unit_price_cents)}</td>
                        <td className="num px-3 py-2.5 text-right font-medium">{formatUsd(l.line_total_cents)}</td>
                        <td className="px-2 py-2 text-right">
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
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-rule">
                    <td className="px-3 py-3" colSpan={2}>
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
                    </td>
                    <td className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted">Total</td>
                    <td className="num px-3 py-3 text-right text-base font-semibold">{formatUsd(order.totalCents)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="mt-4 grid gap-3 rounded-xl border border-rule bg-card p-4 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Bill to</span>
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
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Billing email</span>
                <EmailInput value={order.recipientEmail ?? ''} disabled={!editable || saving} onCommit={(recipientEmail) => patch({ recipientEmail })} />
              </label>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {editable && (
                <>
                  <button
                    className="btn btn-primary !px-5 !py-2.5 !text-base"
                    disabled={saving || !!order.blocker}
                    onClick={async () => {
                      const res = await run(() => api(`/api/orders/${id}/approve`, { method: 'POST' }));
                      if (res) setOrder({ ...order, status: 'sending' });
                    }}
                  >
                    Approve and send invoice
                  </button>
                  <span className="text-sm text-muted">{order.blocker ?? 'Creates and sends a PayPal invoice for the total above.'}</span>
                </>
              )}
              {order.status === 'sending' && (
                <p className="flex items-center gap-2 text-sm text-muted">
                  <span className="live-dot h-2 w-2 rounded-full bg-sky-ink" /> The agent is creating and sending the PayPal invoice…
                </p>
              )}
              {order.invoiceId && !working && (
                <>
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
                  <span className="text-sm text-muted">
                    Invoice <span className="num">{order.invoiceNumber ?? order.invoiceId}</span>
                  </span>
                </>
              )}
            </div>
            {order.status === 'paid' && (
              <p className="mt-4 rounded-lg bg-leaf-soft px-4 py-3 text-sm font-medium text-leaf">Paid through PayPal. Nothing left to chase.</p>
            )}
            {order.status === 'failed' && order.error && (
              <p className="mt-4 rounded-lg bg-brick-soft px-4 py-3 text-sm text-brick">
                {order.error} {order.invoiceId ? 'An invoice exists in PayPal for this order; use Refresh status.' : 'Fix the order or try again.'}
              </p>
            )}
            {qr && (
              <figure className="mt-4 inline-block rounded-xl border border-rule bg-white p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt="PayPal invoice QR code" width={220} height={220} />
                <figcaption className="mt-1 text-center text-xs text-muted">Scan to pay at the counter</figcaption>
              </figure>
            )}
          </>
        )}
        {notice && <p className="mt-3 text-sm text-leaf">{notice}</p>}
        {error && <p className="mt-3 text-sm text-brick">{error}</p>}
        <p className="mt-6 text-sm">
          <Link href="/orders" className="text-muted underline hover:text-ink">
            All orders
          </Link>
        </p>
      </section>

      <ActivityPanel events={order.events} live={working} />
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
