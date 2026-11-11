/**
 * Fill the orders page with believable history so judges do not open an empty grid.
 * Orders are priced through the same catalog code as real ones. No PayPal calls are made:
 * seeded invoices are local records only.
 *
 *   npm run db:seed
 */
import './env';
import { getDb, schema } from '../src/lib/db';
import { addEvent, createOrder, saveParsedOrder, updateOrder } from '../src/lib/orders';
import { resolveOrder } from '../src/lib/pricing';
import type { OrderStatus } from '../src/lib/schema';

type Seed = { text: string; customer: string; note: string | null; lines: [sku: string | null, qty: number | null, raw: string][]; status?: OrderStatus; daysAgo: number };

const SEEDS: Seed[] = [
  { text: 'Send 3 cases of 12oz cups and 10 sleeves of lids. Main St Cafe', customer: 'Main St Cafe', note: null, lines: [['HBR-CUP-12', 60, '3 cases of 12oz cups'], ['HBR-LID-HOT', 10, '10 sleeves of lids']], status: 'paid', daysAgo: 6 },
  { text: 'Necesito 40 paquetes de servilletas para el viernes, tenemos un evento', customer: "Rosa's Taqueria", note: 'Needed by Friday, for an event', lines: [['HBR-NAP-DISP', 40, '40 paquetes de servilletas']], status: 'paid', daysAgo: 4 },
  { text: '8 packs to-go containers + 2 jugs sanitizer pls', customer: 'Harborview Diner', note: null, lines: [['HBR-CLAM-9', 8, '8 packs to-go containers'], ['BRT-SAN-1G', 2, '2 jugs sanitizer']], status: 'invoiced', daysAgo: 2 },
  { text: '20 rolls trash bags y 12 cajas de guantes', customer: "Rosa's Taqueria", note: null, lines: [['BRT-BAG-33', 20, '20 rolls trash bags'], ['GEN-GLV-L', 12, '12 cajas de guantes']], status: 'draft', daysAgo: 1 },
  { text: '6 espresso tampers and 20 rolls of paper towels', customer: 'Main St Cafe', note: null, lines: [[null, 6, '6 espresso tampers'], ['GEN-TWL-RL', 20, '20 rolls of paper towels']], daysAgo: 0 },
];

async function main() {
  const db = await getDb();
  const existing = await db.select({ id: schema.orders.id }).from(schema.orders);
  if (existing.length && !process.argv.includes('--force')) {
    console.log(`Database already has ${existing.length} order(s). Run with --force to add the seed orders anyway.`);
    return;
  }
  let n = 0;
  for (const s of SEEDS) {
    const order = await createOrder({ rawText: s.text, source: 'text' });
    const parsed = resolveOrder({
      customer_name: s.customer,
      delivery_note: s.note,
      lines: s.lines.map(([sku, quantity, raw_text]) => ({
        raw_text,
        sku,
        quantity,
        quantity_unit: 'unit' as const,
        confidence: 0.95,
        flags: sku ? [] : (['not_in_catalog'] as const).slice(),
        flag_reason: sku ? null : 'We do not stock this item.',
        candidate_skus: [],
      })),
    });
    await saveParsedOrder(order.id, parsed);
    await addEvent(order.id, 'step', 'Seeded demo order (no PayPal call)');
    const createdAt = new Date(Date.now() - s.daysAgo * 86_400_000 - n * 3_600_000);
    const patch: Parameters<typeof updateOrder>[1] = { createdAt };
    if (s.status === 'paid' || s.status === 'invoiced') {
      patch.status = s.status;
      patch.invoiceNumber = `DEMO-${String(++n).padStart(4, '0')}`;
    }
    await updateOrder(order.id, patch);
    console.log(order.id, s.status ?? (parsed.needs_info ? 'needs_info' : 'draft'), s.text);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
