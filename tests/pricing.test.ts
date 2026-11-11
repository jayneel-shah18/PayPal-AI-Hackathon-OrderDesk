import { describe, expect, it } from 'vitest';
import { approvalBlocker, resolveLine, resolveOrder } from '@/lib/pricing';
import type { ExtractedLine } from '@/lib/schema';

const line = (over: Partial<ExtractedLine>): ExtractedLine => ({
  raw_text: 'x',
  sku: null,
  quantity: null,
  quantity_unit: 'unit',
  confidence: 0.9,
  flags: [],
  flag_reason: null,
  candidate_skus: [],
  ...over,
});

describe('resolveOrder: the seven sample orders, after extraction', () => {
  it('1 clean: converts cases to units and prices from the catalog', () => {
    const o = resolveOrder({
      customer_name: 'Main St Cafe',
      delivery_note: null,
      lines: [line({ sku: 'HBR-CUP-12', quantity: 2, quantity_unit: 'case' }), line({ sku: 'HBR-FLT-12', quantity: 5 })],
    });
    expect(o.lines[0]).toMatchObject({ qty: 40, unit: 'sleeve', unit_price_cents: 450, line_total_cents: 18000, flags: [] });
    expect(o.lines[1]).toMatchObject({ qty: 5, line_total_cents: 3250, flags: [] });
    expect(o.total_cents).toBe(21250);
    expect(o.needs_info).toBe(false);
  });

  it('2 spanish/english: 10 packs of napkins and 4 jugs of dish soap', () => {
    const o = resolveOrder({
      customer_name: "Rosa's Taqueria",
      delivery_note: 'Needed by tomorrow',
      lines: [line({ sku: 'HBR-NAP-DISP', quantity: 10 }), line({ sku: 'BRT-DSH-1G', quantity: 4 })],
    });
    expect(o.total_cents).toBe(10 * 320 + 4 * 975);
    expect(o.needs_info).toBe(false);
  });

  it('3 ambiguous: keeps flags, prices nothing it is unsure of', () => {
    const o = resolveOrder({
      customer_name: null,
      delivery_note: null,
      lines: [
        line({ quantity: 5, quantity_unit: 'case', flags: ['ambiguous', 'needs_history'], flag_reason: 'Which cup size?', candidate_skus: ['HBR-CUP-12', 'HBR-CUP-16'] }),
        line({ sku: 'HBR-NAP-DISP', quantity: null, flags: ['ambiguous', 'needs_history'], flag_reason: 'How many napkins?' }),
      ],
    });
    expect(o.lines[0]).toMatchObject({ sku: null, qty: null, line_total_cents: null });
    expect(o.lines[0].candidates).toHaveLength(2);
    expect(o.lines[1]).toMatchObject({ sku: 'HBR-NAP-DISP', qty: null, line_total_cents: null });
    expect(o.total_cents).toBe(0);
    expect(o.needs_info).toBe(true);
  });

  it('4 out of stock: code, not the model, flags the shortfall', () => {
    const o = resolveOrder({ customer_name: null, delivery_note: 'Urgent', lines: [line({ sku: 'HBR-CLAM-6', quantity: 30 })] });
    expect(o.lines[0].flags).toEqual(['out_of_stock']);
    expect(o.lines[0].flag_reason).toContain('Only 25 in stock');
    expect(o.needs_info).toBe(true);
  });

  it('5 unknown item: flags the knives, prices the sanitizer', () => {
    const o = resolveOrder({
      customer_name: null,
      delivery_note: null,
      lines: [line({ quantity: 10, flags: ['not_in_catalog'], flag_reason: 'We do not stock chef knives.' }), line({ sku: 'BRT-SAN-1G', quantity: 3 })],
    });
    expect(o.lines[0]).toMatchObject({ sku: null, unit_price_cents: null, flags: ['not_in_catalog'] });
    expect(o.lines[1]).toMatchObject({ qty: 3, line_total_cents: 4200, flags: [] });
    expect(o.total_cents).toBe(4200);
  });

  it('7 email forward: 4 cases of trash bags is 40 rolls', () => {
    const o = resolveOrder({
      customer_name: 'Main St Cafe',
      delivery_note: 'This week',
      lines: [line({ sku: 'BRT-BAG-33', quantity: 4, quantity_unit: 'case' }), line({ sku: 'GEN-GLV-L', quantity: 12 })],
    });
    expect(o.lines[0].qty).toBe(40);
    expect(o.total_cents).toBe(40 * 740 + 12 * 890);
  });
});

describe('resolveLine guards', () => {
  it('drops a SKU the model invented', () => {
    const l = resolveLine(line({ sku: 'HBR-KNIFE-8', quantity: 10 }));
    expect(l).toMatchObject({ sku: null, name: null, unit_price_cents: null, line_total_cents: null });
    expect(l.flags).toContain('not_in_catalog');
  });

  it('ignores an out_of_stock flag from the model when stock is fine', () => {
    expect(resolveLine({ ...line({ sku: 'GEN-GLV-L', quantity: 5 }), flags: ['out_of_stock'] }).flags).toEqual([]);
  });

  it('rejects fractional and negative quantities', () => {
    expect(resolveLine(line({ sku: 'GEN-GLV-L', quantity: 2.5 })).qty).toBeNull();
    expect(resolveLine(line({ sku: 'GEN-GLV-L', quantity: -3 })).flags).toContain('ambiguous');
  });

  it('does not repeat the stock reason when a line is re-saved', () => {
    const first = resolveLine(line({ sku: 'HBR-CLAM-6', quantity: 30 }));
    const again = resolveLine({ ...line({ sku: 'HBR-CLAM-6', quantity: 30 }), flag_reason: first.flag_reason });
    expect(again.flag_reason).toBe(first.flag_reason);
  });
});

describe('approvalBlocker', () => {
  const ok = resolveLine(line({ sku: 'GEN-GLV-L', quantity: 5 }));
  it('passes a clean order', () => {
    expect(approvalBlocker({ lines: [ok], recipientEmail: 'a@b.co', recipientName: 'A' })).toBeNull();
  });
  it('blocks flagged lines, empty orders and missing recipients', () => {
    expect(approvalBlocker({ lines: [resolveLine(line({ quantity: 1 }))], recipientEmail: 'a@b.co', recipientName: 'A' })).toMatch(/flagged/);
    expect(approvalBlocker({ lines: [], recipientEmail: 'a@b.co', recipientName: 'A' })).toMatch(/no lines/);
    expect(approvalBlocker({ lines: [ok], recipientEmail: null, recipientName: 'A' })).toMatch(/email/);
    expect(approvalBlocker({ lines: [ok], recipientEmail: 'a@b.co', recipientName: '' })).toMatch(/customer/);
  });
});
