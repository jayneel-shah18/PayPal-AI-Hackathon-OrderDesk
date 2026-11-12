import { logEvent } from './audit';
import { getDb, schema, seedCustomers } from './db';
import { createOrder, saveParsedOrder, updateOrder } from './orders';
import { resolveOrder } from './pricing';
import type { OrderStatus } from './schema';

type Seed = { text: string; customer: string; note: string | null; lines: [sku: string | null, qty: number | null, raw: string][]; status?: OrderStatus; daysAgo: number };

/** Sample order history, so the Orders page is not empty. All invented demo data. */
export const SEED_ORDERS: Seed[] = [
  { text: 'Send 3 cases of 12oz cups and 10 sleeves of lids. Main St Cafe', customer: 'Main St Cafe', note: null, lines: [['HBR-CUP-12', 60, '3 cases of 12oz cups'], ['HBR-LID-HOT', 10, '10 sleeves of lids']], status: 'paid', daysAgo: 6 },
  { text: 'Necesito 40 paquetes de servilletas para el viernes, tenemos un evento', customer: "Rosa's Taqueria", note: 'Needed by Friday, for an event', lines: [['HBR-NAP-DISP', 40, '40 paquetes de servilletas']], status: 'paid', daysAgo: 4 },
  { text: '8 packs to-go containers + 2 jugs sanitizer pls', customer: 'Harborview Diner', note: null, lines: [['HBR-CLAM-9', 8, '8 packs to-go containers'], ['BRT-SAN-1G', 2, '2 jugs sanitizer']], status: 'invoiced', daysAgo: 2 },
  { text: '20 rolls trash bags y 12 cajas de guantes', customer: "Rosa's Taqueria", note: null, lines: [['BRT-BAG-33', 20, '20 rolls trash bags'], ['GEN-GLV-L', 12, '12 cajas de guantes']], status: 'draft', daysAgo: 1 },
  { text: '6 espresso tampers and 20 rolls of paper towels', customer: 'Main St Cafe', note: null, lines: [[null, 6, '6 espresso tampers'], ['GEN-TWL-RL', 20, '20 rolls of paper towels']], daysAgo: 0 },
];

/**
 * Insert the sample history. Orders are priced through the same catalog code
 * as real ones. Database only: seeded invoices are local records and PayPal is
 * never called.
 */
export async function seedDemoOrders(now: Date = new Date()): Promise<{ id: string; status: OrderStatus; text: string }[]> {
  const out: { id: string; status: OrderStatus; text: string }[] = [];
  let invoices = 0;
  for (const [i, s] of SEED_ORDERS.entries()) {
    const order = await createOrder({ rawText: s.text, source: 'text', receivedAt: new Date(now.getTime() - s.daysAgo * 86_400_000 - (i + 1) * 3_600_000) });
    const parsed = resolveOrder({
      customer_name: s.customer,
      delivery_note: s.note,
      lines: s.lines.map(([sku, quantity, raw_text]) => ({
        raw_text,
        sku,
        quantity,
        quantity_unit: 'unit' as const,
        confidence: 0.95,
        flags: sku ? [] : ['not_in_catalog' as const],
        flag_reason: sku ? null : 'We do not stock this item.',
        candidate_skus: [],
      })),
    });
    await saveParsedOrder(order.id, parsed);
    await logEvent(order.id, 'agent', 'Sample order added to the demo', { note: 'Seeded history. PayPal was not called.' });
    const status = s.status ?? (parsed.needs_info ? 'needs_info' : 'draft');
    if (s.status === 'paid' || s.status === 'invoiced') {
      await updateOrder(order.id, { status: s.status, invoiceNumber: `DEMO-${String(++invoices).padStart(4, '0')}` });
    }
    out.push({ id: order.id, status, text: s.text });
  }
  return out;
}

/**
 * Put the demo back to its starting state: delete every order, order line,
 * audit event and customer, then restore the customers and the sample history.
 * With no orders left, every inbox sample message shows as New again.
 *
 * This only touches the app's own database. It makes no PayPal calls, so
 * invoices already created in the PayPal sandbox are left exactly as they are.
 */
export async function resetDemo(now: Date = new Date()): Promise<{ removedOrders: number; seededOrders: number; customers: number }> {
  const db = await getDb();
  const before = await db.select({ id: schema.orders.id }).from(schema.orders);
  await db.delete(schema.orderEvents);
  await db.delete(schema.orderLines);
  await db.delete(schema.orders);
  await db.delete(schema.customers);
  await seedCustomers(db);
  const seeded = await seedDemoOrders(now);
  const customers = await db.select({ id: schema.customers.id }).from(schema.customers);
  return { removedOrders: before.length, seededOrders: seeded.length, customers: customers.length };
}

/** Reset demo is offered only when DEMO_MODE is explicitly on. */
export function demoModeEnabled(): boolean {
  return /^(true|1|yes|on)$/i.test(process.env.DEMO_MODE?.trim() ?? '');
}
