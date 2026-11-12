/**
 * Fill the orders page with believable history so judges do not open an empty grid.
 * No PayPal calls are made: seeded invoices are local records only.
 *
 *   npm run db:seed    add the sample history (skipped if orders already exist)
 *   npm run db:reset   delete ALL orders and customers first, then seed
 */
import './env';
import { getDb, schema } from '../src/lib/db';
import { resetDemo, seedDemoOrders } from '../src/lib/seed';

async function main() {
  const db = await getDb();
  if (process.argv.includes('--reset')) {
    const where = process.env.DATABASE_URL ? `Postgres at ${new URL(process.env.DATABASE_URL).host}` : 'the local database in ./.data';
    const r = await resetDemo();
    console.log(`Reset ${where}: removed ${r.removedOrders} order(s) and all customers, restored ${r.customers} customers and ${r.seededOrders} sample orders.`);
    return;
  }
  const existing = await db.select({ id: schema.orders.id }).from(schema.orders);
  if (existing.length && !process.argv.includes('--force')) {
    console.log(`Database already has ${existing.length} order(s). Run with --force to add the seed orders anyway.`);
    return;
  }
  for (const o of await seedDemoOrders()) console.log(o.id, o.status, o.text);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
