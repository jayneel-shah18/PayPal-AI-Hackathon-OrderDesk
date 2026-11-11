'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Meta } from '@/lib/client';
import { avatarTone, type Channel, CHANNEL_LABEL, channelOf, formatReceived, initials, previewOf, SAMPLE_SENDERS, todayAt } from '@/lib/inbox';
import { formatUsd, type OrderStatus } from '@/lib/schema';
import { ChannelIcon } from './Icons';
import { StatusChip } from './StatusChip';

type OrderRow = {
  id: string;
  source: string;
  rawText: string;
  status: OrderStatus;
  recipientName: string | null;
  customerHint: string | null;
  totalCents: number;
  createdAt: string;
};

type Message = {
  key: string;
  customer: string;
  channel: Channel;
  preview: string;
  received: Date;
  /** Set once the message has been read into an order. */
  order?: OrderRow;
  /** Set for a message that has not been read yet. */
  sample?: Meta['samples'][number];
};

const isPhotoOrder = (o: OrderRow) => o.source === 'photo';

export function Inbox() {
  const router = useRouter();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(() => {
    api<{ orders: OrderRow[] }>('/api/orders')
      .then((r) => setOrders(r.orders))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    setNow(new Date());
    api<Meta>('/api/meta').then(setMeta).catch((e) => setError(e.message));
    loadOrders();
    const t = setInterval(loadOrders, 5000);
    return () => clearInterval(t);
  }, [loadOrders]);

  const messages = useMemo<Message[]>(() => {
    if (!meta || !orders || !now) return [];
    const used = new Set<string>();
    const list: Message[] = [];
    for (const s of meta.samples) {
      const sender = SAMPLE_SENDERS[s.id] ?? { customer: 'Customer', channel: s.image ? 'photo' : 'text', at: [8, 0] as [number, number] };
      // A message counts as read once an order exists with the same text (or, for the photo, any photo order).
      const order = orders.find((o) => !used.has(o.id) && (s.image ? isPhotoOrder(o) : o.rawText === s.text.trim()));
      if (order) used.add(order.id);
      list.push({
        key: `sample:${s.id}`,
        customer: order?.recipientName ?? sender.customer,
        channel: sender.channel,
        preview: previewOf(sender.channel, s.text),
        received: todayAt(sender.at, now),
        order,
        sample: order ? undefined : s,
      });
    }
    for (const o of orders) {
      if (used.has(o.id)) continue;
      const channel = channelOf(o.source, o.rawText);
      list.push({
        key: o.id,
        customer: o.recipientName ?? o.customerHint ?? 'Unknown customer',
        channel,
        preview: previewOf(channel, o.rawText),
        received: new Date(o.createdAt),
        order: o,
      });
    }
    return list.sort((a, b) => b.received.getTime() - a.received.getTime());
  }, [meta, orders, now]);

  async function open(m: Message) {
    setError(null);
    if (m.order) return router.push(`/orders/${m.order.id}`);
    if (!m.sample || opening) return;
    setOpening(m.key);
    try {
      let image: string | undefined;
      if (m.sample.image) {
        const res = await fetch(m.sample.image);
        if (!res.ok) throw new Error('The photo could not be loaded.');
        const blob = await res.blob();
        image = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('The photo could not be read.'));
          reader.readAsDataURL(blob);
        });
      }
      const { id } = await api<{ id: string }>('/api/parse', { method: 'POST', body: { text: m.sample.text, image } });
      router.push(`/orders/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOpening(null);
    }
  }

  const loading = !meta || !orders || !now;
  const fresh = messages.filter((m) => !m.order).length;
  const attention = messages.filter((m) => m.order?.status === 'needs_info' || m.order?.status === 'failed').length;
  const awaiting = (orders ?? []).filter((o) => o.status === 'invoiced').reduce((s, o) => s + o.totalCents, 0);
  const hour = now?.getHours() ?? 9;
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const missing = meta ? [!meta.config.claude && 'the Claude API key', !meta.config.paypal && 'PayPal sandbox credentials'].filter(Boolean) : [];

  return (
    <div>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="eyebrow">{now ? now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) : ' '}</p>
          <h1 className="font-display text-3xl font-semibold sm:text-4xl">{now ? greeting : 'Inbox'}</h1>
          <p className="mt-1 text-sm text-muted">
            {loading ? (
              'Loading your orders…'
            ) : (
              <>
                <strong className="font-semibold text-ink">{fresh === 0 ? 'No new orders' : `${fresh} new order${fresh === 1 ? '' : 's'}`}</strong> to read
                {attention > 0 && <> · {attention} waiting on an answer</>}
                {awaiting > 0 && (
                  <>
                    {' '}
                    · <span className="num">{formatUsd(awaiting)}</span> awaiting payment
                  </>
                )}
              </>
            )}
          </p>
        </div>
      </div>

      {missing.length > 0 && (
        <p className="mt-4 rounded-lg border border-amber-rule bg-amber-soft px-3 py-2 text-sm text-amber-ink">
          Setup is not finished: {missing.join(' and ')} not set on the server, so new orders cannot be read yet.
        </p>
      )}
      {error && <p className="mt-4 rounded-lg bg-brick-soft px-3 py-2 text-sm text-brick">{error}</p>}

      <ul className="card mt-5 divide-y divide-rule overflow-hidden">
        {loading &&
          [0, 1, 2, 3].map((i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-4">
              <span className="h-10 w-10 rounded-full bg-paper" />
              <span className="h-3 w-1/2 rounded bg-paper" />
            </li>
          ))}
        {!loading && messages.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted">No orders yet. Use New order to add one.</li>}
        {messages.map((m) => {
          const unread = !m.order;
          const busy = opening === m.key;
          return (
            <li key={m.key}>
              <button
                onClick={() => open(m)}
                disabled={!!opening && !busy}
                className={`flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-paper/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-leaf sm:gap-4 sm:px-4 ${unread ? 'bg-white' : ''}`}
              >
                <span className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarTone(m.customer)}`}>
                  {initials(m.customer)}
                  {unread && <span className="absolute -left-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-leaf" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={`truncate text-[15px] ${unread ? 'font-semibold' : 'font-medium'}`}>{m.customer}</span>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted" title={CHANNEL_LABEL[m.channel]}>
                      <ChannelIcon channel={m.channel} />
                      <span className="hidden sm:inline">{CHANNEL_LABEL[m.channel]}</span>
                    </span>
                    <time className="ml-auto shrink-0 text-xs tabular-nums text-muted" dateTime={m.received.toISOString()}>
                      {formatReceived(m.received, now!)}
                    </time>
                  </span>
                  <span className="mt-0.5 flex items-center gap-3">
                    <span className={`min-w-0 flex-1 truncate text-sm ${unread ? 'text-ink' : 'text-muted'}`}>{m.preview}</span>
                    {m.order && m.order.totalCents > 0 && <span className="num hidden shrink-0 text-sm text-muted sm:inline">{formatUsd(m.order.totalCents)}</span>}
                    <span className="shrink-0">
                      {busy ? (
                        <StatusChip status="parsing" />
                      ) : m.order ? (
                        <StatusChip status={m.order.status} />
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-leaf px-2.5 py-0.5 text-xs font-semibold text-white">New</span>
                      )}
                    </span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
