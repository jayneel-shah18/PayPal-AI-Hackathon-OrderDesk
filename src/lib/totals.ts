/**
 * Money math shared by the review grid and the orders page. Prices are never
 * an input here: a line's unit price comes from the catalog and is only read.
 */

export type PricedLine = { qty: number | null; unit_price_cents: number | null; line_total_cents: number | null };

export function lineTotalCents(qty: number | null, unitPriceCents: number | null): number | null {
  return qty != null && unitPriceCents != null ? qty * unitPriceCents : null;
}

export function orderTotalCents(lines: Pick<PricedLine, 'line_total_cents'>[]): number {
  return lines.reduce((sum, l) => sum + (l.line_total_cents ?? 0), 0);
}

/** Turn what was typed into a quantity cell into a whole positive number, or null if it is not one. */
export function parseQuantity(input: unknown): number | null {
  if (input == null || input === '') return null;
  const n = typeof input === 'number' ? input : Number(String(input).trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Apply a quantity edit to one line and recompute that line's total and the
 * order total. The unit price is carried over untouched.
 */
export function applyQuantityEdit<T extends PricedLine>(lines: T[], index: number, qty: number | null): { lines: T[]; totalCents: number } {
  const next = lines.map((l, i) => (i === index ? { ...l, qty, line_total_cents: lineTotalCents(qty, l.unit_price_cents) } : l));
  return { lines: next, totalCents: orderTotalCents(next) };
}
