'use client';

import { AllCommunityModule, type ColDef, type ICellRendererParams, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useMemo } from 'react';
import { formatUsd, type ParsedLine } from '@/lib/schema';
import { lineTotalCents, parseQuantity } from '@/lib/totals';

ModuleRegistry.registerModules([AllCommunityModule]);

type Row = ParsedLine & { index: number; total?: false };
type TotalRow = { total: true; line_total_cents: number };
type AnyRow = Row | TotalRow;

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
  rowHoverColor: 'transparent',
});

const plural = (unit: string) => (/(x|s|ch)$/.test(unit) ? `${unit}es` : `${unit}s`);

/**
 * Order lines as an AG Grid (Community). Quantity and product are editable;
 * the unit price column is read-only because prices come only from the catalog.
 */
export function LinesGrid({
  lines,
  totalCents,
  catalog,
  editable,
  onQty,
  onSku,
  onRemove,
}: {
  lines: ParsedLine[];
  totalCents: number;
  catalog: { sku: string; name: string }[];
  editable: boolean;
  onQty: (index: number, qty: number | null) => void;
  onSku: (index: number, sku: string | null) => void;
  onRemove: (index: number) => void;
}) {
  const rows = useMemo<Row[]>(() => lines.map((l, index) => ({ ...l, index })), [lines]);
  const pinned = useMemo<TotalRow[]>(() => [{ total: true, line_total_cents: totalCents }], [totalCents]);

  const columns = useMemo<ColDef<AnyRow>[]>(
    () => [
      {
        headerName: 'Product',
        flex: 1,
        minWidth: 220,
        editable: (p) => editable && !p.node.rowPinned,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: catalog.map((c) => c.name) },
        valueGetter: (p) => (p.data && !p.data.total ? (p.data.name ?? '') : ''),
        valueSetter: (p) => {
          const item = catalog.find((c) => c.name === p.newValue);
          if (p.data && !p.data.total && item && item.sku !== p.data.sku) onSku(p.data.index, item.sku);
          return false; // the saved order, re-priced on the server, is what the grid shows
        },
        cellRenderer: (p: ICellRendererParams<AnyRow>) => {
          const d = p.data;
          if (!d || d.total) return <span className="eyebrow">Invoice total</span>;
          return (
            <span className="flex h-full flex-col justify-center leading-tight">
              <span className={`truncate text-sm ${d.name ? 'font-medium' : 'text-muted'}`}>{d.name ?? 'Choose a product…'}</span>
              <span className="truncate text-xs text-muted">
                {d.flags.length > 0 && <span className="mr-1.5 font-semibold text-amber-ink">Needs attention ·</span>}
                Customer wrote “{d.raw_text}”
              </span>
            </span>
          );
        },
      },
      {
        headerName: 'Quantity',
        colId: 'qty',
        width: 150,
        editable: (p) => editable && !p.node.rowPinned,
        cellEditor: 'agNumberCellEditor',
        cellEditorParams: { min: 1, precision: 0, showStepperButtons: true },
        valueGetter: (p) => (p.data && !p.data.total ? p.data.qty : null),
        valueSetter: (p) => {
          const qty = parseQuantity(p.newValue);
          if (p.data && !p.data.total && qty !== p.data.qty) onQty(p.data.index, qty);
          return false;
        },
        cellRenderer: (p: ICellRendererParams<AnyRow>) => {
          const d = p.data;
          if (!d || d.total) return null;
          return (
            <span className={`flex h-full items-center ${editable ? 'cursor-text' : ''}`}>
              <span className={`num rounded-md px-2 py-1 text-sm ${editable ? 'border border-rule bg-white' : ''}`}>{d.qty ?? '?'}</span>
              {d.unit && <span className="ml-2 text-xs text-muted">{plural(d.unit)}</span>}
            </span>
          );
        },
      },
      {
        headerName: 'Each',
        width: 110,
        type: 'rightAligned',
        editable: false, // catalog price, never typed in
        cellClass: 'num text-muted',
        valueGetter: (p) => (p.data && !p.data.total ? p.data.unit_price_cents : null),
        valueFormatter: (p) => (p.node?.rowPinned ? '' : formatUsd(p.value)),
        headerTooltip: 'Catalog price. Not editable.',
      },
      {
        headerName: 'Total',
        colId: 'total',
        width: 130,
        type: 'rightAligned',
        editable: false,
        cellClass: (p) => (p.node.rowPinned ? 'num text-lg font-semibold' : 'num font-semibold'),
        valueGetter: (p) => (!p.data ? null : p.data.total ? p.data.line_total_cents : lineTotalCents(p.data.qty, p.data.unit_price_cents)),
        valueFormatter: (p) => formatUsd(p.value),
      },
      {
        headerName: '',
        width: 56,
        resizable: false,
        cellRenderer: (p: ICellRendererParams<AnyRow>) =>
          editable && p.data && !p.data.total ? (
            <button
              className="rounded p-1 text-muted hover:bg-brick-soft hover:text-brick"
              onClick={() => onRemove((p.data as Row).index)}
              aria-label={`Remove line ${(p.data as Row).index + 1}`}
              title="Remove line"
            >
              ✕
            </button>
          ) : null,
      },
    ],
    [catalog, editable, onQty, onSku, onRemove],
  );

  return (
    <AgGridReact<AnyRow>
      theme={theme}
      rowData={rows}
      pinnedBottomRowData={pinned}
      columnDefs={columns}
      getRowId={(p) => (p.data.total ? 'total' : String(p.data.index))}
      domLayout="autoHeight"
      rowHeight={54}
      headerHeight={38}
      singleClickEdit
      stopEditingWhenCellsLoseFocus
      suppressMovableColumns
      suppressCellFocus={!editable}
      defaultColDef={{ sortable: false, resizable: true }}
      rowClassRules={{ 'od-row-flagged': (p) => !!p.data && !p.data.total && p.data.flags.length > 0 }}
      overlayNoRowsTemplate="No lines yet. Add one below."
    />
  );
}
