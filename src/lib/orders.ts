import { randomUUID } from 'node:crypto';
import { asc, desc, eq } from 'drizzle-orm';
import { listEvents, logEvent, type OrderEvent } from './audit';
import { getDb, schema } from './db';
import { approvalBlocker, type LineInput, resolveLine, totalCents } from './pricing';
import type { OrderStatus, ParsedLine, ParsedOrder } from './schema';

const { orders, orderLines, customers } = schema;

export type OrderRow = typeof orders.$inferSelect;
export type CustomerRow = typeof customers.$inferSelect;
export type OrderDetail = OrderRow & { lines: ParsedLine[]; events: OrderEvent[]; blocker: string | null };

export function newOrderId(): string {
  return `ord_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function toParsedLine(row: typeof orderLines.$inferSelect): ParsedLine {
  return {
    raw_text: row.rawText,
    sku: row.sku,
    name: row.name,
    unit: row.unit,
    qty: row.qty,
    unit_price_cents: row.unitPriceCents,
    line_total_cents: row.lineTotalCents,
    confidence: row.confidence,
    flags: row.flags,
    flag_reason: row.flagReason,
    candidates: row.candidates,
  };
}

/**
 * How far back a message's received time may be. Older, future or malformed
 * values are ignored and the order is stamped with the current time instead.
 */
const MAX_RECEIVED_AGE_MS = 30 * 86_400_000;

export function parseReceivedAt(value: unknown, now: Date = new Date()): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const d = new Date(value);
  const t = d.getTime();
  if (!Number.isFinite(t) || t > now.getTime() + 60_000 || t < now.getTime() - MAX_RECEIVED_AGE_MS) return undefined;
  return d;
}

export async function createOrder(input: {
  rawText: string;
  source: 'text' | 'photo';
  /** The customer the message came from, when the sender is already known. */
  customerId?: string | null;
  /** When the message arrived. Shown everywhere as the order's received time. */
  receivedAt?: Date;
}): Promise<OrderRow> {
  const db = await getDb();
  const sender = input.customerId ? (await listCustomers()).find((c) => c.id === input.customerId) : undefined;
  if (input.customerId && !sender) throw new HttpError(400, 'Unknown customer');
  const [row] = await db
    .insert(orders)
    .values({
      id: newOrderId(),
      rawText: input.rawText,
      source: input.source,
      status: 'parsing',
      ...(sender ? { customerId: sender.id, recipientName: sender.name, recipientEmail: sender.email } : {}),
      ...(input.receivedAt ? { createdAt: input.receivedAt } : {}),
    })
    .returning();
  return row;
}

export async function updateOrder(id: string, patch: Partial<typeof orders.$inferInsert>): Promise<void> {
  const db = await getDb();
  await db
    .update(orders)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(orders.id, id));
}

async function writeLines(orderId: string, lines: ParsedLine[]): Promise<void> {
  const db = await getDb();
  await db.delete(orderLines).where(eq(orderLines.orderId, orderId));
  if (lines.length === 0) return;
  await db.insert(orderLines).values(
    lines.map((l, position) => ({
      orderId,
      position,
      rawText: l.raw_text,
      sku: l.sku,
      name: l.name,
      unit: l.unit,
      qty: l.qty,
      unitPriceCents: l.unit_price_cents,
      lineTotalCents: l.line_total_cents,
      confidence: l.confidence,
      flags: l.flags,
      flagReason: l.flag_reason,
      candidates: l.candidates,
    })),
  );
}

function statusFor(lines: ParsedLine[]): OrderStatus {
  return lines.length === 0 || lines.some((l) => l.flags.length) ? 'needs_info' : 'draft';
}

/**
 * Store the parser's result. If the sender was already known when the message
 * arrived, that customer is kept; otherwise match the customer named in the order, if any.
 */
export async function saveParsedOrder(orderId: string, parsed: ParsedOrder): Promise<void> {
  await writeLines(orderId, parsed.lines);
  const db = await getDb();
  const [current] = await db.select({ customerId: orders.customerId }).from(orders).where(eq(orders.id, orderId));
  const update: Partial<typeof orders.$inferInsert> = {
    status: statusFor(parsed.lines),
    totalCents: parsed.total_cents,
    customerHint: parsed.customer_name,
    deliveryNote: parsed.delivery_note,
    error: null,
  };
  if (!current?.customerId) {
    const all = await listCustomers();
    const hint = parsed.customer_name?.toLowerCase();
    const match = hint ? all.find((c) => c.name.toLowerCase().includes(hint) || hint.includes(c.name.toLowerCase())) : undefined;
    update.customerId = match?.id ?? null;
    update.recipientName = match?.name ?? parsed.customer_name;
    update.recipientEmail = match?.email ?? null;
  }
  await updateOrder(orderId, update);
}

export const EDITABLE: OrderStatus[] = ['draft', 'needs_info', 'failed'];

/**
 * Apply the owner's edits. Lines are re-priced from the catalog on the server:
 * the client only says which SKU and how many.
 */
export async function editOrder(
  id: string,
  patch: {
    lines?: (Pick<LineInput, 'raw_text' | 'sku' | 'flags' | 'flag_reason' | 'candidate_skus'> & { qty: number | null })[];
    customerId?: string | null;
    recipientName?: string | null;
    recipientEmail?: string | null;
    deliveryNote?: string | null;
  },
): Promise<OrderDetail> {
  const current = await getOrder(id);
  if (!current) throw new HttpError(404, 'Order not found');
  if (!EDITABLE.includes(current.status)) throw new HttpError(409, `Order is ${current.status} and can no longer be edited.`);

  const update: Partial<typeof orders.$inferInsert> = {};
  if (patch.customerId !== undefined) {
    update.customerId = patch.customerId;
    const c = patch.customerId ? (await listCustomers()).find((x) => x.id === patch.customerId) : undefined;
    if (patch.customerId && !c) throw new HttpError(400, 'Unknown customer');
    if (c) {
      update.recipientName = c.name;
      update.recipientEmail = c.email;
    }
  }
  if (patch.recipientName !== undefined) update.recipientName = patch.recipientName;
  if (patch.recipientEmail !== undefined) update.recipientEmail = patch.recipientEmail?.trim() || null;
  if (patch.deliveryNote !== undefined) update.deliveryNote = patch.deliveryNote;

  if (patch.lines) {
    const lines = patch.lines.map((l) =>
      resolveLine({
        raw_text: l.raw_text,
        sku: l.sku,
        quantity: l.qty,
        quantity_unit: 'unit',
        confidence: 1,
        flags: l.flags,
        flag_reason: l.flag_reason,
        candidate_skus: l.candidate_skus,
      }),
    );
    await writeLines(id, lines);
    update.totalCents = totalCents(lines);
    update.status = statusFor(lines);
    update.error = null;
    await logLineEdits(id, current.lines, lines, current.totalCents, update.totalCents);
  }
  await updateOrder(id, update);
  return (await getOrder(id))!;
}

/** Record what the owner changed on the review screen. */
async function logLineEdits(orderId: string, before: ParsedLine[], after: ParsedLine[], totalBefore: number, totalAfter: number): Promise<void> {
  const totals = { order_total_before_usd: (totalBefore / 100).toFixed(2), order_total_after_usd: (totalAfter / 100).toFixed(2) };
  if (after.length < before.length) return logEvent(orderId, 'owner', 'Owner removed a line', { lines_before: before.length, lines_after: after.length, ...totals });
  if (after.length > before.length) return logEvent(orderId, 'owner', 'Owner added a line', { lines_before: before.length, lines_after: after.length, ...totals });
  for (let i = 0; i < after.length; i++) {
    const was = before[i];
    const now = after[i];
    if (was.sku !== now.sku) {
      await logEvent(orderId, 'owner', 'Owner changed product', { line: i + 1, customer_wrote: now.raw_text, from: was.sku, to: now.sku, ...totals });
    } else if (was.qty !== now.qty) {
      await logEvent(orderId, 'owner', 'Owner edited quantity', {
        line: i + 1,
        product: now.name,
        from: was.qty,
        to: now.qty,
        line_total_usd: now.line_total_cents == null ? null : (now.line_total_cents / 100).toFixed(2),
        ...totals,
      });
    } else if (was.flags.length && !now.flags.length) {
      await logEvent(orderId, 'owner', 'Owner cleared a flag', { line: i + 1, customer_wrote: now.raw_text });
    }
  }
}

export async function getOrder(id: string): Promise<OrderDetail | null> {
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order) return null;
  const lineRows = await db.select().from(orderLines).where(eq(orderLines.orderId, id)).orderBy(asc(orderLines.position));
  const eventRows = await listEvents(id);
  const lines = lineRows.map(toParsedLine);
  return {
    ...order,
    lines,
    events: eventRows,
    blocker: approvalBlocker({ lines, recipientEmail: order.recipientEmail, recipientName: order.recipientName }),
  };
}

export async function listOrders(): Promise<OrderRow[]> {
  const db = await getDb();
  return db.select().from(orders).orderBy(desc(orders.createdAt));
}

export async function findOrderByInvoiceId(invoiceId: string): Promise<OrderRow | null> {
  const db = await getDb();
  const [row] = await db.select().from(orders).where(eq(orders.invoiceId, invoiceId));
  return row ?? null;
}

export async function listCustomers(): Promise<CustomerRow[]> {
  const db = await getDb();
  return db.select().from(customers).orderBy(asc(customers.name));
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
