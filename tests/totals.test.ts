import { describe, expect, it } from 'vitest';
import { customerOf, groupOrders } from '@/lib/grouping';
import { applyQuantityEdit, lineTotalCents, orderTotalCents, parseQuantity } from '@/lib/totals';

const lines = [
  { sku: 'HBR-NAP-DISP', qty: 10, unit_price_cents: 320, line_total_cents: 3200 },
  { sku: 'BRT-DSH-1G', qty: 4, unit_price_cents: 975, line_total_cents: 3900 },
];

describe('quantity edits in the review grid', () => {
  it('recalculates the line total and the order total', () => {
    const next = applyQuantityEdit(lines, 0, 25);
    expect(next.lines[0]).toMatchObject({ qty: 25, line_total_cents: 8000 });
    expect(next.lines[1]).toEqual(lines[1]);
    expect(next.totalCents).toBe(11900);
    expect(orderTotalCents(lines)).toBe(7100); // the original is not mutated
  });

  it('never changes the unit price', () => {
    const next = applyQuantityEdit(lines, 1, 100);
    expect(next.lines.map((l) => l.unit_price_cents)).toEqual([320, 975]);
  });

  it('a cleared quantity leaves the line unpriced and out of the total', () => {
    const next = applyQuantityEdit(lines, 0, null);
    expect(next.lines[0].line_total_cents).toBeNull();
    expect(next.totalCents).toBe(3900);
  });

  it('accepts only whole positive quantities', () => {
    expect(parseQuantity('12')).toBe(12);
    expect(parseQuantity(7)).toBe(7);
    expect(parseQuantity(' 3 ')).toBe(3);
    for (const bad of ['', null, undefined, '0', '-4', '2.5', 'ten']) expect(parseQuantity(bad)).toBeNull();
    expect(lineTotalCents(3, null)).toBeNull();
  });
});

describe('orders page grouping', () => {
  const at = (d: number) => new Date(2026, 10, d).toISOString();
  const orders = [
    { id: 'a', status: 'paid' as const, recipientName: "Rosa's Taqueria", customerHint: null, totalCents: 12800, createdAt: at(7) },
    { id: 'b', status: 'paid' as const, recipientName: 'Main St Cafe', customerHint: null, totalCents: 29750, createdAt: at(5) },
    { id: 'c', status: 'invoiced' as const, recipientName: 'Harborview Diner', customerHint: null, totalCents: 11600, createdAt: at(9) },
    { id: 'd', status: 'draft' as const, recipientName: "Rosa's Taqueria", customerHint: null, totalCents: 25480, createdAt: at(10) },
    { id: 'e', status: 'failed' as const, recipientName: null, customerHint: null, totalCents: 0, createdAt: at(11) },
  ];

  it('groups by status with a total per group', () => {
    const g = groupOrders(orders, 'status');
    expect(g.map((x) => [x.title, x.rows.length, x.totalCents])).toEqual([
      ['Draft', 1, 25480],
      ['Needs info', 0, 0],
      ['Invoiced', 1, 11600],
      ['Paid', 2, 42550],
      ['Other', 1, 0],
    ]);
    expect(g[3].rows.map((r) => r.id)).toEqual(['a', 'b']); // newest first
  });

  it('groups by customer', () => {
    const g = groupOrders(orders, 'customer');
    expect(g.map((x) => [x.title, x.rows.length, x.totalCents])).toEqual([
      ['Harborview Diner', 1, 11600],
      ['Main St Cafe', 1, 29750],
      ["Rosa's Taqueria", 2, 38280],
      ['Unknown customer', 1, 0],
    ]);
    expect(customerOf(orders[4])).toBe('Unknown customer');
  });

  it('applies the status filter before grouping', () => {
    expect(groupOrders(orders, 'status', 'paid').map((x) => x.title)).toEqual(['Paid']);
    const byCustomer = groupOrders(orders, 'customer', 'paid');
    expect(byCustomer.map((x) => [x.title, x.totalCents])).toEqual([
      ['Main St Cafe', 29750],
      ["Rosa's Taqueria", 12800],
    ]);
  });
});
