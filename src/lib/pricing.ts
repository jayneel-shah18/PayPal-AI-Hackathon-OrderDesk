import { type CatalogItem, findSku, getCatalog } from './catalog';
import { type ExtractedOrder, type Flag, MODEL_FLAGS, type ParsedLine, type ParsedOrder } from './schema';

export type LineInput = {
  raw_text: string;
  sku: string | null;
  quantity: number | null;
  quantity_unit: 'unit' | 'case';
  confidence?: number;
  flags?: string[];
  flag_reason?: string | null;
  candidate_skus?: string[];
};

/**
 * Turn one extracted (or hand-edited) line into a priced, validated line.
 *
 * This is the only place names, prices and stock enter an order, and they all
 * come from the catalog. A SKU that is not in the catalog is dropped and the
 * line is flagged, so the model can never invent a product or a price.
 */
export function resolveLine(input: LineInput, catalog: CatalogItem[] = getCatalog()): ParsedLine {
  const flags = new Set<Flag>((input.flags ?? []).filter((f): f is Flag => (MODEL_FLAGS as readonly string[]).includes(f)));
  const reasons: string[] = [];
  const addReason = (r: string) => {
    if (!reasons.some((x) => x.includes(r))) reasons.push(r);
  };
  if (input.flag_reason?.trim()) reasons.push(input.flag_reason.trim());

  const candidates = [...new Set(input.candidate_skus ?? [])]
    .map((s) => findSku(s, catalog))
    .filter((i): i is CatalogItem => !!i)
    .map((i) => ({ sku: i.sku, name: i.name }));

  const item = findSku(input.sku, catalog);
  if (input.sku && !item) {
    flags.add('not_in_catalog');
    addReason(`"${input.sku}" is not a SKU in the catalog.`);
  }
  if (!item && !flags.has('not_in_catalog') && !flags.has('ambiguous')) {
    flags.add(candidates.length ? 'ambiguous' : 'not_in_catalog');
    if (reasons.length === 0) reasons.push(candidates.length ? 'More than one catalog item could match.' : 'No matching catalog item.');
  }

  let qty: number | null = null;
  const q = input.quantity;
  if (q == null || !Number.isFinite(q) || q <= 0 || !Number.isInteger(q)) {
    flags.add('ambiguous');
    if (!/quantit|how many/i.test(reasons.join(' '))) addReason('Quantity is missing or unclear.');
  } else if (input.quantity_unit === 'case') {
    // Case size is only known once the product is known.
    qty = item ? q * item.packSize : null;
  } else {
    qty = q;
  }

  if (item && qty != null && qty > item.stock) {
    flags.add('out_of_stock');
    addReason(
      item.stock > 0
        ? `Only ${item.stock} in stock, ${qty} requested. Send ${item.stock} now or wait for restock.`
        : `Out of stock, ${qty} requested.`,
    );
  }

  const lineTotal = item && qty != null ? item.priceCents * qty : null;
  const confidence = Math.min(1, Math.max(0, input.confidence ?? 1));

  return {
    raw_text: input.raw_text,
    sku: item?.sku ?? null,
    name: item?.name ?? null,
    unit: item?.unit ?? null,
    qty,
    unit_price_cents: item?.priceCents ?? null,
    line_total_cents: lineTotal,
    confidence,
    flags: [...flags],
    flag_reason: reasons.length ? reasons.join(' ') : null,
    candidates,
  };
}

export function totalCents(lines: Pick<ParsedLine, 'line_total_cents'>[]): number {
  return lines.reduce((sum, l) => sum + (l.line_total_cents ?? 0), 0);
}

export function resolveOrder(extracted: ExtractedOrder, catalog: CatalogItem[] = getCatalog()): ParsedOrder {
  const lines = extracted.lines.map((l) => resolveLine(l, catalog));
  return {
    customer_name: extracted.customer_name?.trim() || null,
    delivery_note: extracted.delivery_note?.trim() || null,
    lines,
    total_cents: totalCents(lines),
    needs_info: lines.length === 0 || lines.some((l) => l.flags.length > 0),
  };
}

/** Why an order cannot be invoiced yet, or null if it can. */
export function approvalBlocker(order: {
  lines: ParsedLine[];
  recipientEmail: string | null;
  recipientName: string | null;
}): string | null {
  if (order.lines.length === 0) return 'The order has no lines.';
  const flagged = order.lines.filter((l) => l.flags.length > 0).length;
  if (flagged) return `${flagged} line${flagged > 1 ? 's' : ''} still flagged. Fix or remove ${flagged > 1 ? 'them' : 'it'} first.`;
  if (order.lines.some((l) => !l.sku || !l.qty || l.unit_price_cents == null)) return 'Every line needs a product and a quantity.';
  if (!order.recipientName?.trim()) return 'Pick a customer.';
  if (!order.recipientEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(order.recipientEmail)) return 'Add a billing email for the customer.';
  return null;
}
