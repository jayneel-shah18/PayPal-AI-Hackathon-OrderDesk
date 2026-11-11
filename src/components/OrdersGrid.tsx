'use client';

import { AllCommunityModule, type ColDef, type ICellRendererParams, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/client';
import { formatUsd, type OrderStatus, STATUS_LABEL } from '@/lib/schema';
import { StatusChip } from './StatusChip';

ModuleRegistry.registerModules([AllCommunityModule]);

type Row = {
  id: string;
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

const theme = themeQuartz.withParams({
  backgroundColor: '#fffdf8',
  foregroundColor: '#1d1b16',
  headerBackgroundColor: '#f5f2ea',
  borderColor: '#e2dccd',
  accentColor: '#17694a',
  fontFamily: 'inherit',
  headerFontWeight: 600,
});

export function OrdersGrid() {
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

  // Poll so a webhook-driven change to Paid shows up without a click.
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

  const columns = useMemo<ColDef<Row>[]>(
    () => [
      {
        headerName: 'Order',
        field: 'id',
        width: 170,
        cellRenderer: (p: ICellRendererParams<Row>) => (
          <Link href={`/orders/${p.value}`} className="num text-[13px] underline decoration-rule underline-offset-2 hover:decoration-ink">
            {p.value}
          </Link>
        ),
      },
      {
        headerName: 'Received',
        field: 'createdAt',
        width: 160,
        sort: 'desc',
        valueFormatter: (p) => new Date(p.value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      },
      { headerName: 'Customer', width: 180, valueGetter: (p) => p.data?.recipientName ?? p.data?.customerHint ?? '—' },
      { headerName: 'Message', field: 'rawText', flex: 1, minWidth: 220, tooltipField: 'rawText' },
      {
        headerName: 'Status',
        field: 'status',
        width: 130,
        filterValueGetter: (p) => (p.data ? STATUS_LABEL[p.data.status] : ''),
        cellRenderer: (p: ICellRendererParams<Row>) => (p.data ? <StatusChip status={p.data.status} /> : null),
      },
      {
        headerName: 'Total',
        field: 'totalCents',
        width: 120,
        type: 'rightAligned',
        cellClass: 'num',
        valueFormatter: (p) => formatUsd(p.value),
      },
      {
        headerName: 'Invoice',
        field: 'invoiceNumber',
        width: 150,
        cellRenderer: (p: ICellRendererParams<Row>) => {
          const d = p.data;
          const label = d?.invoiceNumber ?? d?.invoiceId;
          if (!d || !label) return <span className="text-muted">—</span>;
          return d.invoiceUrl ? (
            <a href={d.invoiceUrl} target="_blank" rel="noreferrer" className="num text-[13px] underline decoration-rule underline-offset-2 hover:decoration-ink">
              {label} ↗
            </a>
          ) : (
            <span className="num text-[13px]">{label}</span>
          );
        },
      },
      {
        headerName: '',
        width: 120,
        sortable: false,
        filter: false,
        cellRenderer: (p: ICellRendererParams<Row>) =>
          p.data?.invoiceId ? (
            <button className="btn !py-0.5 !text-xs" disabled={refreshing === p.data.id} onClick={() => refreshOne(p.data!.id)}>
              {refreshing === p.data.id ? 'Checking…' : 'Refresh'}
            </button>
          ) : null,
      },
    ],
    [refreshOne, refreshing],
  );

  const paid = rows?.filter((r) => r.status === 'paid').reduce((s, r) => s + r.totalCents, 0) ?? 0;
  const open = rows?.filter((r) => r.status === 'invoiced').reduce((s, r) => s + r.totalCents, 0) ?? 0;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
        <h1 className="font-display text-3xl font-semibold">Orders</h1>
        <dl className="flex gap-6 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">Awaiting payment</dt>
            <dd className="num text-lg font-semibold">{formatUsd(open)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">Paid</dt>
            <dd className="num text-lg font-semibold text-leaf">{formatUsd(paid)}</dd>
          </div>
        </dl>
        <Link href="/" className="btn btn-primary ml-auto">
          New order
        </Link>
      </div>
      {error && <p className="mt-3 text-sm text-brick">{error}</p>}
      <div className="mt-4 h-[70vh] min-h-[420px]">
        <AgGridReact<Row>
          theme={theme}
          rowData={rows ?? undefined}
          loading={rows === null}
          columnDefs={columns}
          getRowId={(p) => p.data.id}
          defaultColDef={{ sortable: true, filter: true, resizable: true }}
          rowHeight={46}
          tooltipShowDelay={400}
          overlayNoRowsTemplate="No orders yet. Paste one on the New order page."
        />
      </div>
    </div>
  );
}
