import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

type Holder = { db?: Promise<Db> };
// Survive Next.js dev hot reloads: one connection per process.
const holder = ((globalThis as unknown as { __orderdesk?: Holder }).__orderdesk ??= {});

/**
 * Apply the SQL files in ./migrations in name order, once each. Runs at startup
 * and from `npm run db:migrate`, against Neon Postgres or the embedded database alike.
 */
export async function runMigrations(db: Db): Promise<string[]> {
  await db.execute(sql.raw('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())'));
  const done = await db.execute(sql.raw('SELECT name FROM schema_migrations'));
  const applied = new Set((done.rows as { name: string }[]).map((r) => r.name));
  const dir = path.join(process.cwd(), 'migrations');
  const ran: string[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue;
    const statements = fs.readFileSync(path.join(dir, file), 'utf8').split('--> statement-breakpoint');
    for (const statement of statements) if (statement.trim()) await db.execute(sql.raw(statement));
    await db.execute(sql`INSERT INTO schema_migrations (name) VALUES (${file}) ON CONFLICT DO NOTHING`);
    ran.push(file);
  }
  return ran;
}

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
  await runMigrations(db);
  await seedCustomers(db);
  return db;
}

export async function seedCustomers(db: Db) {
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
