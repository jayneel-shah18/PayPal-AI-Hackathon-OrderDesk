-- Base tables. Every statement is idempotent, so this is safe on a database
-- that was created before migrations were tracked.
CREATE TABLE IF NOT EXISTS customers (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY,
  source text NOT NULL DEFAULT 'text',
  raw_text text NOT NULL,
  status text NOT NULL DEFAULT 'parsing',
  customer_id text,
  recipient_name text,
  recipient_email text,
  customer_hint text,
  delivery_note text,
  total_cents integer NOT NULL DEFAULT 0,
  invoice_id text,
  invoice_number text,
  invoice_url text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS order_lines (
  id serial PRIMARY KEY,
  order_id text NOT NULL,
  position integer NOT NULL,
  raw_text text NOT NULL,
  sku text,
  name text,
  unit text,
  qty integer,
  unit_price_cents integer,
  line_total_cents integer,
  confidence real NOT NULL DEFAULT 1,
  flags jsonb NOT NULL DEFAULT '[]',
  flag_reason text,
  candidates jsonb NOT NULL DEFAULT '[]'
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS order_lines_order_idx ON order_lines (order_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS orders_invoice_idx ON orders (invoice_id);
