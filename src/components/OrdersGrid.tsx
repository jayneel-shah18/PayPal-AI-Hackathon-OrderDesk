'use client';

import { AllCommunityModule, type ColDef, type ICellRendererParams, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/client';
import { channelOf, previewOf } from '@/lib/inbox';
import { formatUsd, type OrderStatus } from '@/lib/schema';
import { StatusChip } from './StatusChip';

ModuleRegistry.registerModules([AllCommunityModule]);

type Row = {
  id: string;
  source: string;
  status: OrderStatus;
  recipientName: string | null;
  customerHint: string | null;
  rawText: string;
  totalCents: number;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceUrl: string | null;
  createdAt: string;
};

type Group = { key: string; title: string; hint: string; statuses: OrderStatus[]; dot: string; tone: string };

const GROUPS: Group[] = [
  { key: 'draft', title: 'Draft', hint: 'Ready for you to approve', statuses: ['draft'], dot: 'bg-ink', tone: 'text-ink' },
  { key: 'needs_info', title: 'Needs info', hint: 'Waiting on an answer', statuses: ['needs_info'], dot: 'bg-amber-rule', tone: 'text-amber-ink' },
  { key: 'invoiced', title: 'Invoiced', hint: 'Sent, awaiting payment', statuses: ['invoiced'], dot: 'bg-sky-ink', tone: 'text-sky-ink' },
  { key: 'paid', title: 'Paid', hint: 'Money in', statuses: ['paid'], dot: 'bg-leaf', tone: 'text-leaf' },
];
const OTHER: Group = { key: 'other', title: 'Other', hint: 'In progress, failed or cancelled', statuses: ['parsing', 'sending', 'failed', 'cancelled'], dot: 'bg-muted', tone: 'text-muted' };

const theme = themeQuartz.withParams({
  backgroundColor: '#fffdf8',
  foregroundColor: '#1d1b16',
  headerBackgroundColor: '#fffdf8',
  headerTextColor: '#6b6558',
  borderColor: '#e2dccd',
  accentColor: '#17694a',
  fontFamily: 'inherit',
  headerFontWeight: 600,
  headerFontSize: 12,
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  rowHoverColor: '#f5f2ea',
});

const customerOf = (r: Row) => r.recipientName ?? r.customerHint ?? 'Unknown customer';
const previewOfRow = (r: Row) => previewOf(channelOf(r.source, r.rawText), r.rawText);
const receivedOf = (r: Row) => new Date(r.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const sum = (rows: Row[]) => rows.reduce((s, r) => s + r.totalCents, 0);

export function OrdersGrid() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await api<{ orders: Row[] }>('/api/orders')).orders);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Poll so a payment shows up without a click.
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const refreshOne = useCallback(
    async (id: string) => {
      setRefreshing(id);
      try {
        await api(`/api/orders/${id}/refresh`, { method: 'POST' });
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setRefreshing(null);
      }
    },
    [load],
  );

  const invoiceCell = useCallback((d: Row | undefined) => {
    const label = d?.invoiceNumber ?? d?.invoiceId;
    if (!d || !label) return <span className="text-muted">—</span>;
    return d.invoiceUrl ? (
      <a href={d.invoiceUrl} target="_blank" rel="noreferrer" className="num text-[13px] underline decoration-rule underline-offset-2 hover:decoration-ink">
        {label} ↗
      </a>
    ) : (
      <span className="num text-[13px]">{label}</span>
    );
  }, []);

  const columns = useMemo<ColDef<Row>[]>(
    () => [
      {
        headerName: 'Customer',
        width: 190,
        valueGetter: (p) => (p.data ? customerOf(p.data) : ''),
        cellRenderer: (p: ICellRendererParams<Row>) => (
          <Link href={`/orders/${p.data?.id}`} className="font-medium hover:underline">
            {p.value}
          </Link>
        ),
      },
      { headerName: 'Order', flex: 1, minWidth: 200, valueGetter: (p) => (p.data ? previewOfRow(p.data) : ''), cellClass: 'text-muted' },
      { headerName: 'Received', field: 'createdAt', width: 150, sort: 'desc', valueFormatter: (p) => (p.data ? receivedOf(p.data) : '') },
      { headerName: 'Invoice', field: 'invoiceNumber', width: 140, cellRenderer: (p: ICellRendererParams<Row>) => invoiceCell(p.data) },
      { headerName: 'Total', field: 'totalCents', width: 120, type: 'rightAligned', cellClass: 'num font-semibold', valueFormatter: (p) => formatUsd(p.value) },
      {
        headerName: '',
        width: 110,
        sortable: false,
        cellRenderer: (p: ICellRendererParams<Row>) =>
          p.data?.invoiceId ? (
            <button className="btn !py-0.5 !text-xs" disabled={refreshing === p.data.id} onClick={() => refreshOne(p.data!.id)}>
              {refreshing === p.data.id ? 'Checking…' : 'Refresh'}
            </button>
          ) : null,
      },
    ],
    [invoiceCell, refreshOne, refreshing],
  );

  const grouped = useMemo(() => {
    const all = rows ?? [];
    const out = GROUPS.map((g) => ({ group: g, rows: all.filter((r) => g.statuses.includes(r.status)) }));
    const rest = all.filter((r) => OTHER.statuses.includes(r.status));
    if (rest.length) out.push({ group: OTHER, rows: rest });
    return out;
  }, [rows]);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold sm:text-4xl">Orders</h1>
          <p className="mt-1 text-sm text-muted">Every order, from first message to money in.</p>
        </div>
      </div>
      {error && <p className="mt-4 rounded-lg bg-brick-soft px-3 py-2 text-sm text-brick">{error}</p>}

      <dl className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {grouped
          .filter((g) => g.group !== OTHER)
          .map(({ group, rows: r }) => (
            <a key={group.key} href={`#${group.key}`} className="card block p-4 transition hover:border-ink">
              <dt className="flex items-center gap-2 text-sm font-medium">
                <span className={`h-2 w-2 rounded-full ${group.dot}`} />
                {group.title}
              </dt>
              <dd className={`num mt-1 text-2xl font-semibold ${group.tone}`}>{rows ? formatUsd(sum(r)) : '—'}</dd>
              <dd className="text-xs text-muted">{rows ? `${r.length} order${r.length === 1 ? '' : 's'}` : ' '}</dd>
            </a>
          ))}
      </dl>

      {rows === null && <p className="mt-6 text-sm text-muted">Loading orders…</p>}

      {rows !== null &&
        grouped.map(({ group, rows: r }) => (
          <section key={group.key} id={group.key} className="mt-6 scroll-mt-20">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-1">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <span className={`h-2.5 w-2.5 rounded-full ${group.dot}`} />
                {group.title}
              </h2>
              <span className="text-sm text-muted">{group.hint}</span>
              <span className="ml-auto text-sm text-muted">
                {r.length} order{r.length === 1 ? '' : 's'} · <span className="num font-semibold text-ink">{formatUsd(sum(r))}</span>
              </span>
            </div>

            {r.length === 0 ? (
              <p className="card mt-2 px-4 py-4 text-sm text-muted">Nothing here right now.</p>
            ) : (
              <>
                {/* Laptop and up: AG Grid */}
                <div className="card mt-2 hidden overflow-hidden md:block">
                  <AgGridReact<Row>
                    theme={theme}
                    rowData={r}
                    columnDefs={columns}
                    getRowId={(p) => p.data.id}
                    domLayout="autoHeight"
                    defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }}
                    rowHeight={48}
                    headerHeight={38}
                    rowClass="cursor-pointer"
                    suppressCellFocus
                    onRowClicked={(e) => {
                      const target = e.event?.target as HTMLElement | null;
                      if (e.data && !target?.closest('a,button')) router.push(`/orders/${e.data.id}`);
                    }}
                  />
                </div>
                {/* Phone: one card per order */}
                <ul className="card mt-2 divide-y divide-rule overflow-hidden md:hidden">
                  {r.map((o) => (
                    <li key={o.id} className="px-4 py-3">
                      <Link href={`/orders/${o.id}`} className="block">
                        <span className="flex items-baseline gap-3">
                          <span className="min-w-0 flex-1 truncate font-medium">{customerOf(o)}</span>
                          <span className="num shrink-0 font-semibold">{formatUsd(o.totalCents)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-sm text-muted">{previewOfRow(o)}</span>
                      </Link>
                      <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                        <span>{receivedOf(o)}</span>
                        {group === OTHER && <StatusChip status={o.status} />}
                        {(o.invoiceNumber ?? o.invoiceId) && <span>Invoice {invoiceCell(o)}</span>}
                        {o.invoiceId && (
                          <button className="btn ml-auto !py-0.5 !text-xs" disabled={refreshing === o.id} onClick={() => refreshOne(o.id)}>
                            {refreshing === o.id ? 'Checking…' : 'Refresh'}
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        ))}
    </div>
  );
}
