'use client';

import { AllCommunityModule, type ColDef, type ICellRendererParams, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/client';
import { customerOf, type GroupBy, groupOrders, type OrderGroup, STATUS_GROUPS, type StatusFilter, sumCents } from '@/lib/grouping';
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

/** What the grid shows: a group heading, an order, or the pinned total. */
type GridRow = { kind: 'group'; group: OrderGroup<Row> } | { kind: 'order'; order: Row } | { kind: 'total'; count: number; totalCents: number };

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

const previewOfRow = (r: Row) => previewOf(channelOf(r.source, r.rawText), r.rawText);
const receivedOf = (r: Row) => new Date(r.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const countLabel = (n: number) => `${n} order${n === 1 ? '' : 's'}`;

function GroupHeading({ group }: { group: OrderGroup<Row> }) {
  return (
    <div className="flex h-full w-full items-center gap-3 bg-paper px-4">
      <span className={`h-2.5 w-2.5 rounded-full ${group.dot}`} />
      <span className="text-sm font-semibold">{group.title}</span>
      {group.hint && <span className="hidden text-sm text-muted lg:inline">{group.hint}</span>}
      <span className="ml-auto text-sm text-muted">
        {countLabel(group.rows.length)} · <span className="num font-semibold text-ink">{formatUsd(group.totalCents)}</span>
      </span>
    </div>
  );
}

export function OrdersGrid() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>('status');
  const [filter, setFilter] = useState<StatusFilter>('all');

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

  const groups = useMemo(() => groupOrders(rows ?? [], groupBy, filter), [rows, groupBy, filter]);
  const visible = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const gridRows = useMemo<GridRow[]>(
    () => groups.filter((g) => g.rows.length > 0).flatMap((g) => [{ kind: 'group' as const, group: g }, ...g.rows.map((order) => ({ kind: 'order' as const, order }))]),
    [groups],
  );
  const pinned = useMemo<GridRow[]>(() => [{ kind: 'total', count: visible.length, totalCents: sumCents(visible) }], [visible]);

  const columns = useMemo<ColDef<GridRow>[]>(
    () => [
      {
        headerName: 'Customer',
        width: 190,
        cellRenderer: (p: ICellRendererParams<GridRow>) => {
          const d = p.data;
          if (d?.kind === 'total') return <span className="eyebrow">Total · {countLabel(d.count)}</span>;
          if (d?.kind !== 'order') return null;
          return (
            <Link href={`/orders/${d.order.id}`} className="font-medium hover:underline">
              {customerOf(d.order)}
            </Link>
          );
        },
      },
      { headerName: 'Order', flex: 1, minWidth: 180, cellClass: 'text-muted', valueGetter: (p) => (p.data?.kind === 'order' ? previewOfRow(p.data.order) : '') },
      {
        headerName: 'Status',
        width: 130,
        cellRenderer: (p: ICellRendererParams<GridRow>) => (p.data?.kind === 'order' ? <StatusChip status={p.data.order.status} /> : null),
      },
      { headerName: 'Received', width: 150, valueGetter: (p) => (p.data?.kind === 'order' ? receivedOf(p.data.order) : '') },
      { headerName: 'Invoice', width: 130, cellRenderer: (p: ICellRendererParams<GridRow>) => (p.data?.kind === 'order' ? invoiceCell(p.data.order) : null) },
      {
        headerName: 'Total',
        width: 120,
        type: 'rightAligned',
        cellClass: (p) => (p.node.rowPinned ? 'num text-base font-semibold' : 'num font-semibold'),
        valueGetter: (p) => (p.data?.kind === 'order' ? p.data.order.totalCents : p.data?.kind === 'total' ? p.data.totalCents : null),
        valueFormatter: (p) => formatUsd(p.value),
      },
      {
        headerName: '',
        width: 124,
        cellRenderer: (p: ICellRendererParams<GridRow>) => {
          const o = p.data?.kind === 'order' ? p.data.order : null;
          return o?.invoiceId ? (
            <button className="btn !py-0.5 !text-xs" disabled={refreshing === o.id} onClick={() => refreshOne(o.id)}>
              {refreshing === o.id ? 'Checking…' : 'Refresh'}
            </button>
          ) : null;
        },
      },
    ],
    [invoiceCell, refreshOne, refreshing],
  );

  const tiles = useMemo(() => {
    const all = rows ?? [];
    return STATUS_GROUPS.map((g) => ({ ...g, rows: all.filter((r) => r.status === g.key) }));
  }, [rows]);

  const segment = (active: boolean) => `rounded-md px-3 py-1 text-sm font-medium transition ${active ? 'bg-card text-ink shadow-sm' : 'text-muted hover:text-ink'}`;
  const chip = (active: boolean) => `rounded-full border px-3 py-1 text-sm transition ${active ? 'border-leaf bg-leaf-soft font-medium text-leaf' : 'border-rule bg-card text-muted hover:border-ink hover:text-ink'}`;

  return (
    <div>
      <h1 className="font-display text-3xl font-semibold sm:text-4xl">Orders</h1>
      <p className="mt-1 text-sm text-muted">Every order, from first message to money in.</p>
      {error && <p className="mt-4 rounded-lg bg-brick-soft px-3 py-2 text-sm text-brick">{error}</p>}

      <dl className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(filter === t.key ? 'all' : t.key)}
            aria-pressed={filter === t.key}
            className={`card block p-4 text-left transition hover:border-ink ${filter === t.key ? '!border-leaf ring-1 ring-leaf' : ''}`}
          >
            <dt className="flex items-center gap-2 text-sm font-medium">
              <span className={`h-2 w-2 rounded-full ${t.dot}`} />
              {t.title}
            </dt>
            <dd className={`num mt-1 text-2xl font-semibold ${t.tone}`}>{rows ? formatUsd(sumCents(t.rows)) : '—'}</dd>
            <dd className="text-xs text-muted">{rows ? countLabel(t.rows.length) : ' '}</dd>
          </button>
        ))}
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="eyebrow">Group by</span>
          <div className="flex rounded-lg border border-rule bg-paper p-0.5" role="group" aria-label="Group orders by">
            <button className={segment(groupBy === 'status')} aria-pressed={groupBy === 'status'} onClick={() => setGroupBy('status')}>
              Status
            </button>
            <button className={segment(groupBy === 'customer')} aria-pressed={groupBy === 'customer'} onClick={() => setGroupBy('customer')}>
              Customer
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by status">
          <span className="eyebrow mr-1">Show</span>
          <button className={chip(filter === 'all')} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </button>
          {STATUS_GROUPS.map((g) => (
            <button key={g.key} className={chip(filter === g.key)} aria-pressed={filter === g.key} onClick={() => setFilter(g.key)}>
              {g.title}
            </button>
          ))}
        </div>
      </div>

      {rows === null && <p className="mt-6 text-sm text-muted">Loading orders…</p>}

      {rows !== null && (
        <>
          {/* Laptop and up: one AG Grid with group headings and a pinned total row */}
          <div className="card mt-4 hidden overflow-hidden md:block">
            <AgGridReact<GridRow>
              theme={theme}
              rowData={gridRows}
              pinnedBottomRowData={pinned}
              columnDefs={columns}
              getRowId={(p) => (p.data.kind === 'group' ? p.data.group.key : p.data.kind === 'order' ? p.data.order.id : 'total')}
              domLayout="autoHeight"
              defaultColDef={{ sortable: false, resizable: true, suppressMovable: true }}
              rowHeight={48}
              headerHeight={38}
              getRowHeight={(p) => (p.data?.kind === 'group' ? 40 : undefined)}
              isFullWidthRow={(p) => p.rowNode.data?.kind === 'group'}
              fullWidthCellRenderer={(p: ICellRendererParams<GridRow>) => (p.data?.kind === 'group' ? <GroupHeading group={p.data.group} /> : null)}
              rowClassRules={{ 'cursor-pointer': (p) => p.data?.kind === 'order' }}
              suppressCellFocus
              overlayNoRowsTemplate="No orders match."
              onRowClicked={(e) => {
                const target = e.event?.target as HTMLElement | null;
                if (e.data?.kind === 'order' && !target?.closest('a,button')) router.push(`/orders/${e.data.order.id}`);
              }}
            />
          </div>

          {/* Phone: one card list per group, then the total */}
          <div className="md:hidden">
            {groups
              .filter((g) => g.rows.length > 0)
              .map((g) => (
                <section key={g.key} className="mt-5">
                  <div className="flex flex-wrap items-baseline gap-x-3 px-1">
                    <h2 className="flex items-center gap-2 text-base font-semibold">
                      <span className={`h-2.5 w-2.5 rounded-full ${g.dot}`} />
                      {g.title}
                    </h2>
                    <span className="ml-auto text-sm text-muted">
                      {countLabel(g.rows.length)} · <span className="num font-semibold text-ink">{formatUsd(g.totalCents)}</span>
                    </span>
                  </div>
                  <ul className="card mt-2 divide-y divide-rule overflow-hidden">
                    {g.rows.map((o) => (
                      <li key={o.id} className="px-4 py-3">
                        <Link href={`/orders/${o.id}`} className="block">
                          <span className="flex items-baseline gap-3">
                            <span className="min-w-0 flex-1 truncate font-medium">{customerOf(o)}</span>
                            <span className="num shrink-0 font-semibold">{formatUsd(o.totalCents)}</span>
                          </span>
                          <span className="mt-0.5 block truncate text-sm text-muted">{previewOfRow(o)}</span>
                        </Link>
                        <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                          <StatusChip status={o.status} />
                          <span>{receivedOf(o)}</span>
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
                </section>
              ))}
            <p className="card mt-5 flex items-baseline gap-3 px-4 py-3">
              <span className="eyebrow">Total · {countLabel(visible.length)}</span>
              <span className="num ml-auto text-lg font-semibold">{formatUsd(sumCents(visible))}</span>
            </p>
          </div>
        </>
      )}
    </div>
  );
}
