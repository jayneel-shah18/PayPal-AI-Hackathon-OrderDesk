import { integer, jsonb, pgTable, real, serial, text, timestamp } from 'drizzle-orm/pg-core';
import type { Flag, OrderStatus } from '../schema';

export const customers = pgTable('customers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
});

export const orders = pgTable('orders', {
  id: text('id').primaryKey(),
  source: text('source').notNull().default('text'), // text | photo
  rawText: text('raw_text').notNull(),
  status: text('status').$type<OrderStatus>().notNull().default('parsing'),
  customerId: text('customer_id'),
  recipientName: text('recipient_name'),
  recipientEmail: text('recipient_email'),
  customerHint: text('customer_hint'), // name as written in the order
  deliveryNote: text('delivery_note'),
  totalCents: integer('total_cents').notNull().default(0),
  invoiceId: text('invoice_id'),
  invoiceNumber: text('invoice_number'),
  invoiceUrl: text('invoice_url'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orderLines = pgTable('order_lines', {
  id: serial('id').primaryKey(),
  orderId: text('order_id').notNull(),
  position: integer('position').notNull(),
  rawText: text('raw_text').notNull(),
  sku: text('sku'),
  name: text('name'),
  unit: text('unit'),
  qty: integer('qty'),
  unitPriceCents: integer('unit_price_cents'),
  lineTotalCents: integer('line_total_cents'),
  confidence: real('confidence').notNull().default(1),
  flags: jsonb('flags').$type<Flag[]>().notNull().default([]),
  flagReason: text('flag_reason'),
  candidates: jsonb('candidates').$type<{ sku: string; name: string }[]>().notNull().default([]),
});

export const events = pgTable('events', {
  id: serial('id').primaryKey(),
  orderId: text('order_id').notNull(),
  kind: text('kind').notNull(), // step | tool_call | tool_result | webhook | error
  label: text('label').notNull(),
  detail: jsonb('detail').$type<unknown>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Idempotent DDL, run once at startup, so a fresh database needs no migration step. */
export const DDL = [
  `CREATE TABLE IF NOT EXISTS customers (
     id text PRIMARY KEY, name text NOT NULL, email text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS orders (
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
     updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS order_lines (
     id serial PRIMARY KEY,
     order_id text NOT NULL,
     position integer NOT NULL,
     raw_text text NOT NULL,
     sku text, name text, unit text, qty integer,
     unit_price_cents integer, line_total_cents integer,
     confidence real NOT NULL DEFAULT 1,
     flags jsonb NOT NULL DEFAULT '[]',
     flag_reason text,
     candidates jsonb NOT NULL DEFAULT '[]')`,
  `CREATE INDEX IF NOT EXISTS order_lines_order_idx ON order_lines (order_id)`,
  `CREATE TABLE IF NOT EXISTS events (
     id serial PRIMARY KEY,
     order_id text NOT NULL,
     kind text NOT NULL,
     label text NOT NULL,
     detail jsonb,
     created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS events_order_idx ON events (order_id)`,
  `CREATE INDEX IF NOT EXISTS orders_invoice_idx ON orders (invoice_id)`,
];
