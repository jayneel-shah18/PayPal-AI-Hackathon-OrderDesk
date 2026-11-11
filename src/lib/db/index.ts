import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

type Holder = { db?: Promise<Db> };
// Survive Next.js dev hot reloads: one connection per process.
const holder = ((globalThis as unknown as { __orderdesk?: Holder }).__orderdesk ??= {});

async function connect(): Promise<Db> {
  let db: Db;
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    db = drizzle(new Pool({ connectionString: url, max: 5 }), { schema });
  } else {
    // No DATABASE_URL: embedded Postgres (PGlite). On disk for local dev, in memory for tests.
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    let client;
    if (process.env.ORDERDESK_DB === 'memory') client = new PGlite();
    else {
      const dir = path.join(process.cwd(), '.data', 'pglite');
      fs.mkdirSync(dir, { recursive: true });
      client = new PGlite(dir);
    }
    db = drizzle(client, { schema }) as unknown as Db;
  }
  for (const statement of schema.DDL) await db.execute(sql.raw(statement));
  await seedCustomers(db);
  return db;
}

async function seedCustomers(db: Db) {
  const file = path.join(process.cwd(), 'data', 'customers.json');
  const rows = JSON.parse(fs.readFileSync(file, 'utf8')) as { id: string; name: string; email: string }[];
  // PAYPAL_BUYER_EMAIL points every demo customer at the sandbox buyer so the invoice can be paid.
  const buyer = process.env.PAYPAL_BUYER_EMAIL?.trim();
  for (const r of rows) {
    await db
      .insert(schema.customers)
      .values({ ...r, email: buyer || r.email })
      .onConflictDoNothing();
  }
}

export function getDb(): Promise<Db> {
  if (!holder.db) {
    holder.db = connect().catch((err) => {
      holder.db = undefined;
      throw err;
    });
  }
  return holder.db;
}

export { schema };
