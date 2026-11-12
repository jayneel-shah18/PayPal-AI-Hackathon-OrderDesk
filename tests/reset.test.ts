import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

process.env.ORDERDESK_DB = 'memory';
delete process.env.DATABASE_URL;
// The reset path must never reach PayPal: with no credentials, any PayPal call would throw.
delete process.env.PAYPAL_CLIENT_ID;
delete process.env.PAYPAL_CLIENT_SECRET;

const { getDb, schema, runMigrations } = await import('@/lib/db');
const orders = await import('@/lib/orders');
const audit = await import('@/lib/audit');
const { demoModeEnabled, resetDemo, SEED_ORDERS } = await import('@/lib/seed');
const { POST } = await import('@/app/demo/reset/route');

const count = async (table: 'orders' | 'order_lines' | 'order_events' | 'customers') => {
  const db = await getDb();
  const r = await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`));
  return (r.rows[0] as { n: number }).n;
};

/** The state a reset must always produce, however messy the database was. */
async function expectSeedState() {
  const all = await orders.listOrders();
  expect(all).toHaveLength(SEED_ORDERS.length);
  expect(all.map((o) => o.rawText).sort()).toEqual(SEED_ORDERS.map((s) => s.text).sort());
  expect(all.map((o) => o.status).sort()).toEqual(['draft', 'invoiced', 'needs_info', 'paid', 'paid']);
  expect((await orders.listCustomers()).map((c) => c.name)).toEqual(['Harborview Diner', 'Main St Cafe', "Rosa's Taqueria", 'Walk-in customer']);
  expect(await count('order_lines')).toBe(SEED_ORDERS.reduce((n, s) => n + s.lines.length, 0));
  expect(await count('order_events')).toBe(SEED_ORDERS.length); // one "sample order added" entry each
  expect(all.every((o) => o.invoiceId === null)).toBe(true); // seeded invoices are local labels, not PayPal invoices
}

describe('Reset demo', () => {
  afterEach(() => {
    delete process.env.DEMO_MODE;
  });

  it('restores the seed state from a database full of other orders', async () => {
    const db = await getDb();
    // A messy starting point: an opened inbox message, a stale customer and extra history.
    const opened = await orders.createOrder({ rawText: '5 cases of cups and some napkins, same as last time', source: 'text', customerId: 'cust_harborview' });
    await audit.logEvent(opened.id, 'agent', 'Message received');
    await orders.updateOrder(opened.id, { status: 'invoiced', invoiceId: 'INV2-REAL-0001' });
    await db.insert(schema.customers).values({ id: 'cust_old', name: 'Old Customer', email: 'old@example.com' });
    await orders.createOrder({ rawText: 'something else', source: 'text' });
    expect(await count('orders')).toBe(2);

    const result = await resetDemo();
    expect(result).toEqual({ removedOrders: 2, seededOrders: 5, customers: 4 });
    await expectSeedState();
    // The opened inbox message is gone, so the inbox shows it as New again.
    expect((await orders.listOrders()).some((o) => o.rawText.startsWith('5 cases of cups'))).toBe(false);
  });

  it('is repeatable', async () => {
    await resetDemo();
    await resetDemo();
    await expectSeedState();
  });

  it('endpoint refuses unless DEMO_MODE is on, and changes nothing', async () => {
    await resetDemo();
    const extra = await orders.createOrder({ rawText: 'keep me', source: 'text' });
    for (const value of [undefined, '', 'false', '0']) {
      if (value === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = value;
      expect(demoModeEnabled()).toBe(false);
      const res = await POST();
      expect(res.status).toBe(403);
    }
    expect(await orders.getOrder(extra.id)).not.toBeNull();
  });

  it('endpoint resets when DEMO_MODE is true', async () => {
    process.env.DEMO_MODE = 'true';
    await orders.createOrder({ rawText: 'wipe me', source: 'text' });
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, seededOrders: 5, customers: 4 });
    await expectSeedState();
  });
});

describe('migrations', () => {
  it('are recorded and do not run twice', async () => {
    const db = await getDb();
    expect(await runMigrations(db)).toEqual([]);
    const r = await db.execute(sql.raw('SELECT name FROM schema_migrations ORDER BY name'));
    expect((r.rows as { name: string }[]).map((x) => x.name)).toEqual(['0001_init.sql', '0002_order_events.sql']);
  });

  it('order_events rejects an unknown actor', async () => {
    const o = await orders.createOrder({ rawText: 'x', source: 'text' });
    await expect(audit.logEvent(o.id, 'robot' as never, 'nope')).rejects.toThrow();
  });

  it('carries history over from the old events table on an existing database', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const db = drizzle(new PGlite(), { schema }) as unknown as Awaited<ReturnType<typeof getDb>>;
    // An "old" database: base tables plus the previous events table, with history in it.
    const init = fs.readFileSync(path.join(process.cwd(), 'migrations', '0001_init.sql'), 'utf8');
    for (const st of init.split('--> statement-breakpoint')) await db.execute(sql.raw(st));
    await db.execute(sql.raw(`CREATE TABLE events (id serial PRIMARY KEY, order_id text NOT NULL, kind text NOT NULL, label text NOT NULL, detail jsonb, created_at timestamptz NOT NULL DEFAULT now())`));
    await db.execute(sql.raw(`INSERT INTO orders (id, raw_text) VALUES ('ord_old', 'old order')`));
    await db.execute(sql.raw(`INSERT INTO events (order_id, kind, label, detail) VALUES
      ('ord_old', 'step', 'Reading the order', NULL),
      ('ord_old', 'step', 'Owner approved the order', '{"total_cents": 100}'),
      ('ord_old', 'webhook', 'PayPal webhook · INVOICING.INVOICE.PAID', NULL),
      ('ord_gone', 'step', 'Orphan', NULL)`));

    expect(await runMigrations(db)).toEqual(['0001_init.sql', '0002_order_events.sql']);
    const r = await db.execute(sql.raw('SELECT actor, action FROM order_events ORDER BY id'));
    expect(r.rows).toEqual([
      { actor: 'agent', action: 'Reading the order' },
      { actor: 'owner', action: 'Owner approved the order' },
      { actor: 'paypal', action: 'PayPal webhook · INVOICING.INVOICE.PAID' },
    ]);
    expect(await runMigrations(db)).toEqual([]);
  });
});
