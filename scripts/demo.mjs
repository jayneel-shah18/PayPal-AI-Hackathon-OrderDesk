/**
 * One command from a fresh clone to a running app:  npm run demo
 * Installs dependencies, creates .env.local from the template if missing,
 * seeds sample orders (skipped if the database already has orders), starts the dev server.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!fs.existsSync('node_modules')) run('npm', ['install']);
if (!fs.existsSync('.env.local')) {
  fs.copyFileSync('.env.example', '.env.local');
  console.log('\nCreated .env.local (gitignored). Add your Claude key and PayPal SANDBOX credentials there to parse orders and send invoices.\n');
}
run('npm', ['run', 'db:seed']);
run('npm', ['run', 'dev']);
