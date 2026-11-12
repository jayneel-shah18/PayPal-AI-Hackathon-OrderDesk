import { asc, eq } from 'drizzle-orm';
import { type CatalogItem, findSku, getCatalog } from './catalog';
import { getDb, schema } from './db';
import type { Actor } from './db/schema';
import type { ExtractedOrder, ParsedOrder } from './schema';

export type { Actor };
export type OrderEvent = typeof schema.orderEvents.$inferSelect;

/** Exact wording of the guardrail events, so tests and the UI can rely on it. */
export const GUARDRAIL = {
  sendBeforeApproval: 'Send invoice blocked: waiting on owner approval',
  createBeforeApproval: 'Create invoice blocked: waiting on owner approval',
  priceNotInCatalog: 'Price blocked: not the catalog price',
  productNotInCatalog: 'Product blocked: not in the catalog',
  differsFromApproved: 'Invoice blocked: differs from the approved order',
} as const;

/** Append one entry to an order's audit trail. */
export async function logEvent(orderId: string, actor: Actor, action: string, detail?: Record<string, unknown>): Promise<void> {
  const db = await getDb();
  await db.insert(schema.orderEvents).values({ orderId, actor, action, detail: detail ?? null });
}

/** Record that a code-level guard stopped the agent. Shown as a "Guardrail" chip on the timeline. */
export function logBlocked(orderId: string, action: string, reason: string, detail: Record<string, unknown> = {}): Promise<void> {
  return logEvent(orderId, 'agent', action, { guardrail: true, reason, ...detail });
}

export async function listEvents(orderId: string): Promise<OrderEvent[]> {
  const db = await getDb();
  return db.select().from(schema.orderEvents).where(eq(schema.orderEvents.orderId, orderId)).orderBy(asc(schema.orderEvents.id));
}

export function isGuardrail(event: { detail: unknown }): boolean {
  return !!event.detail && typeof event.detail === 'object' && (event.detail as { guardrail?: unknown }).guardrail === true;
}

const usd = (cents: number | null) => (cents == null ? null : (cents / 100).toFixed(2));

/**
 * Write the parse result to the audit trail: one summary, then one entry per
 * line (a catalog match or a flag), plus a guardrail entry for anything the
 * model proposed that the catalog does not back.
 */
export async function logParseResult(
  orderId: string,
  extracted: ExtractedOrder | undefined,
  parsed: ParsedOrder,
  model: string,
  catalog: CatalogItem[] = getCatalog(),
): Promise<void> {
  const flagged = parsed.lines.filter((l) => l.flags.length).length;
  await logEvent(orderId, 'agent', 'Parsed by AI', { model, lines: parsed.lines.length, flagged, customer: parsed.customer_name, delivery_note: parsed.delivery_note });

  for (const proposal of extracted?.lines ?? []) {
    if (proposal.sku && !findSku(proposal.sku, catalog)) {
      await logBlocked(orderId, GUARDRAIL.productNotInCatalog, `The AI proposed "${proposal.sku}", which is not a catalog SKU. The line was left unpriced.`, {
        raw_text: proposal.raw_text,
        proposed_sku: proposal.sku,
      });
    }
  }

  for (const line of parsed.lines) {
    if (line.sku) {
      await logEvent(orderId, 'agent', `Catalog match: ${line.qty ?? '?'} × ${line.name}`, {
        customer_wrote: line.raw_text,
        sku: line.sku,
        qty: line.qty,
        unit: line.unit,
        unit_price_usd: usd(line.unit_price_cents),
        line_total_usd: usd(line.line_total_cents),
        price_source: 'catalog',
      });
    }
    if (line.flags.length) {
      await logEvent(orderId, 'agent', `Line flagged for review: "${line.raw_text}"`, { flags: line.flags, reason: line.flag_reason });
    }
  }
}
