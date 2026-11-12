import { bigserial, integer, jsonb, pgTable, real, serial, text, timestamp } from 'drizzle-orm/pg-core';
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

export const ACTORS = ['agent', 'owner', 'paypal'] as const;
export type Actor = (typeof ACTORS)[number];

/** Audit trail. Created by migrations/0002_order_events.sql. */
export const orderEvents = pgTable('order_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  orderId: text('order_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  actor: text('actor').$type<Actor>().notNull(),
  action: text('action').notNull(),
  detail: jsonb('detail').$type<Record<string, unknown> | null>(),
});
