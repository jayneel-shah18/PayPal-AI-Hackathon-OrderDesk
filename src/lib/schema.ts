import { z } from 'zod';

/** Flags the model may raise. `out_of_stock` is never the model's call: code checks stock. */
export const MODEL_FLAGS = ['ambiguous', 'not_in_catalog', 'needs_history'] as const;
export const FLAGS = [...MODEL_FLAGS, 'out_of_stock'] as const;
export type Flag = (typeof FLAGS)[number];

/**
 * What the model returns for one requested item. It carries no price and no
 * product name: those always come from the catalog in code (see pricing.ts).
 */
export const ExtractedLineSchema = z.object({
  raw_text: z.string().describe('The words from the order that this line came from, verbatim.'),
  sku: z
    .string()
    .nullable()
    .describe('Exact SKU returned by search_catalog, or null when no single catalog item is clearly meant.'),
  quantity: z.number().nullable().describe('The number the customer wrote, or null if they gave none ("some", "a few").'),
  quantity_unit: z
    .enum(['unit', 'case'])
    .describe('"case" if the customer counted in full cases or cartons; otherwise "unit" (the product\'s own selling unit: sleeve, pack, box, jug, roll).'),
  confidence: z.number().describe('0 to 1: how sure you are that sku and quantity are what the customer meant.'),
  flags: z.array(z.enum(MODEL_FLAGS)).describe('Empty when the line is clear.'),
  flag_reason: z.string().nullable().describe('One short sentence for the owner explaining each flag, else null.'),
  candidate_skus: z.array(z.string()).describe('When ambiguous: the SKUs it could be. Otherwise empty.'),
});
export type ExtractedLine = z.infer<typeof ExtractedLineSchema>;

export const ExtractedOrderSchema = z.object({
  customer_name: z.string().nullable().describe('Customer or shop name if the order states one, else null.'),
  delivery_note: z.string().nullable().describe('Delivery timing, urgency or address notes in plain English, else null.'),
  lines: z.array(ExtractedLineSchema),
});
export type ExtractedOrder = z.infer<typeof ExtractedOrderSchema>;

/** A priced, validated order line as stored and shown on the review screen. */
export const ParsedLineSchema = z.object({
  raw_text: z.string(),
  sku: z.string().nullable(),
  name: z.string().nullable(),
  unit: z.string().nullable(),
  /** Quantity in sellable units (sleeves, packs, boxes, jugs, rolls), after case conversion. */
  qty: z.number().int().nullable(),
  unit_price_cents: z.number().int().nullable(),
  line_total_cents: z.number().int().nullable(),
  confidence: z.number().min(0).max(1),
  flags: z.array(z.enum(FLAGS)),
  flag_reason: z.string().nullable(),
  candidates: z.array(z.object({ sku: z.string(), name: z.string() })),
});
export type ParsedLine = z.infer<typeof ParsedLineSchema>;

export const ParsedOrderSchema = z.object({
  customer_name: z.string().nullable(),
  delivery_note: z.string().nullable(),
  lines: z.array(ParsedLineSchema),
  total_cents: z.number().int(),
  needs_info: z.boolean(),
});
export type ParsedOrder = z.infer<typeof ParsedOrderSchema>;

export const ORDER_STATUSES = ['parsing', 'draft', 'needs_info', 'sending', 'invoiced', 'paid', 'cancelled', 'failed'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const STATUS_LABEL: Record<OrderStatus, string> = {
  parsing: 'Reading',
  draft: 'Draft',
  needs_info: 'Needs info',
  sending: 'Sending',
  invoiced: 'Invoiced',
  paid: 'Paid',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

export function formatUsd(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
