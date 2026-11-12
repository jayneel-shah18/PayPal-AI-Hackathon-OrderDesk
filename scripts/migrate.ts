/**
 * Apply pending SQL migrations from ./migrations to the database in DATABASE_URL
 * (or the local embedded database). The app also does this on startup.
 *
 *   npm run db:migrate
 */
import './env';
import { sql } from 'drizzle-orm';
import { getDb } from '../src/lib/db';

async function main() {
  const db = await getDb(); // connecting applies anything pending
  const rows = await db.execute(sql.raw('SELECT name, applied_at FROM schema_migrations ORDER BY name'));
  const where = process.env.DATABASE_URL ? `Postgres at ${new URL(process.env.DATABASE_URL).host}` : 'the local database in ./.data';
  console.log(`Migrations applied on ${where}:`);
  for (const r of rows.rows as { name: string; applied_at: string | Date }[]) console.log(`  ${r.name}  ${new Date(r.applied_at).toISOString()}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
