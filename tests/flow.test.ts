import { tool, type ToolSet } from 'ai';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ExtractedOrder } from '@/lib/schema';
import { scriptedModel } from './helpers';

process.env.ORDERDESK_DB = 'memory';
delete process.env.DATABASE_URL;

// Imported after the env is set so the in-memory database is used.
const { beginApproval, invoiceArgsFor, makeApprovalGuard, runApproval, syncInvoiceStatus } = await import('@/lib/approve');
const orders = await import('@/lib/orders');
const audit = await import('@/lib/audit');
const { GUARDRAIL } = audit;

const actions = (o: { events: { action: string }[] }) => o.events.map((e) => e.action);
const { parseOrder } = await import('@/lib/parse');
const { applyWebhookEvent } = await import('@/lib/webhook');
const { extractQrPng, invoiceIdFrom, orderStatusFor, summarizeInvoice } = await import('@/lib/paypal');

/** Stand-in for PayPal: records calls and returns sandbox-shaped responses. */
function fakePayPal() {
  const calls: { tool: string; input: Record<string, unknown> }[] = [];
  const build =
    (hooks: { guard: Parameters<typeof makeApprovalGuard>[1] extends never ? never : ReturnType<typeof makeApprovalGuard>; observe: (e: never) => unknown }): ToolSet => {
      const wrap = (name: 'create_invoice' | 'send_invoice' | 'get_invoice', respond: (input: Record<string, unknown>) => unknown) =>
        tool({
          description: name,
          inputSchema: z.object({}).passthrough(),
          execute: async (input: Record<string, unknown>) => {
            const refusal = await hooks.guard(name, input);
            if (refusal) {
              await (hooks.observe as (e: unknown) => unknown)({ tool: name, input, error: `Blocked: ${refusal}` });
              return { error: refusal };
            }
            calls.push({ tool: name, input });
            const output = respond(input);
            await (hooks.observe as (e: unknown) => unknown)({ tool: name, input, output });
            return output;
          },
        });
      return {
        create_invoice: wrap('create_invoice', () => ({ rel: 'self', href: 'https://api.sandbox.paypal.com/v2/invoicing/invoices/INV2-TEST-0001', method: 'GET' })),
        send_invoice: wrap('send_invoice', () => ({ success: true })),
        get_invoice: wrap('get_invoice', () => ({ id: 'INV2-TEST-0001', status: 'SENT' })),
      };
    };
  return { calls, build: build as never };
}

async function draftOrder() {
  const order = await orders.createOrder({ rawText: 'Necesito 10 paquetes de servilletas y 4 jugs of dish soap', source: 'text' });
  let extracted: ExtractedOrder | undefined;
  const parsed = await parseOrder(
    { text: order.rawText },
    {
      model: scriptedModel([
        [
          { tool: 'search_catalog', input: { query: 'servilletas' } },
          { tool: 'search_catalog', input: { query: 'dish soap' } },
        ],
        JSON.stringify({
          customer_name: "Rosa's Taqueria",
          delivery_note: 'Needed by tomorrow',
          lines: [
            { raw_text: '10 paquetes de servilletas', sku: 'HBR-NAP-DISP', quantity: 10, quantity_unit: 'unit', confidence: 0.95, flags: [], flag_reason: null, candidate_skus: [] },
            { raw_text: '4 jugs of dish soap', sku: 'BRT-DSH-1G', quantity: 4, quantity_unit: 'unit', confidence: 0.95, flags: [], flag_reason: null, candidate_skus: [] },
          ],
        }),
      ]),
      onTool: (e) => audit.logEvent(order.id, 'agent', `Searched catalog: "${(e.input as { query: string }).query}"`, { matches: e.output }),
      onExtracted: (x) => {
        extracted = x;
      },
    },
  );
  await orders.saveParsedOrder(order.id, parsed);
  await audit.logParseResult(order.id, extracted, parsed, 'scripted-model');
  return (await orders.getOrder(order.id))!;
}

const sentInvoice = async () => ({ id: 'INV2-TEST-0001', status: 'SENT', invoiceNumber: '0001', recipientViewUrl: 'https://www.sandbox.paypal.com/invoice/p/#TEST', totalCents: 7100, currency: 'USD' });

describe('order flow against an in-memory database', () => {
  beforeAll(async () => {
    await orders.listCustomers();
  });

  it('parses with tool calls, prices in code, matches the customer', async () => {
    const o = await draftOrder();
    expect(o.status).toBe('draft');
    expect(o.totalCents).toBe(10 * 320 + 4 * 975);
    expect(o.customerId).toBe('cust_rosas');
    expect(o.blocker).toBeNull();
    expect(actions(o).filter((a) => a.startsWith('Searched catalog'))).toHaveLength(2);
  });

  it('keeps the known sender and received time when the order names no customer', async () => {
    const receivedAt = new Date(Date.now() - 3 * 3_600_000);
    const order = await orders.createOrder({ rawText: '5 cases of cups and some napkins, same as last time', source: 'text', customerId: 'cust_harborview', receivedAt });
    await orders.saveParsedOrder(order.id, { customer_name: null, delivery_note: null, lines: [], total_cents: 0, needs_info: true });
    const saved = (await orders.getOrder(order.id))!;
    expect(saved).toMatchObject({ customerId: 'cust_harborview', recipientName: 'Harborview Diner', recipientEmail: 'accounts@harborviewdiner.example' });
    expect(saved.createdAt.getTime()).toBe(receivedAt.getTime());
    await expect(orders.createOrder({ rawText: 'x', source: 'text', customerId: 'cust_nobody' })).rejects.toThrow(/Unknown customer/);
  });

  it('accepts only a sensible received time', () => {
    const now = new Date('2026-11-11T18:00:00Z');
    expect(orders.parseReceivedAt('2026-11-11T07:18:00Z', now)?.toISOString()).toBe('2026-11-11T07:18:00.000Z');
    expect(orders.parseReceivedAt('2026-11-12T07:18:00Z', now)).toBeUndefined(); // future
    expect(orders.parseReceivedAt('2026-01-01T00:00:00Z', now)).toBeUndefined(); // too old
    expect(orders.parseReceivedAt('yesterday-ish', now)).toBeUndefined();
    expect(orders.parseReceivedAt(undefined, now)).toBeUndefined();
  });

  it('re-prices edits on the server and flags a quantity above stock', async () => {
    const o = await draftOrder();
    const edited = await orders.editOrder(o.id, { lines: [{ raw_text: 'small containers', sku: 'HBR-CLAM-6', qty: 30 }] });
    expect(edited.status).toBe('needs_info');
    expect(edited.lines[0].flags).toEqual(['out_of_stock']);
    const fixed = await orders.editOrder(o.id, { lines: [{ raw_text: 'small containers', sku: 'HBR-CLAM-6', qty: 25 }] });
    expect(fixed).toMatchObject({ status: 'draft', totalCents: 25 * 800 });
  });

  it('refuses to approve a flagged order', async () => {
    const o = await draftOrder();
    await orders.editOrder(o.id, { lines: [{ raw_text: 'chef knives', sku: null, qty: 10 }] });
    await expect(beginApproval(o.id)).rejects.toThrow(/flagged/);
  });

  it('approve: agent creates then sends, order becomes invoiced with the payer link', async () => {
    const o = await beginApproval((await draftOrder()).id);
    const paypal = fakePayPal();
    const args = invoiceArgsFor(o);
    await runApproval(o, {
      model: scriptedModel([[{ tool: 'create_invoice', input: args }], [{ tool: 'send_invoice', input: { invoice_id: 'INV2-TEST-0001' } }], 'Invoice INV2-TEST-0001 sent.']),
      buildTools: paypal.build,
      fetchInvoice: sentInvoice,
    });
    const done = (await orders.getOrder(o.id))!;
    expect(paypal.calls.map((c) => c.tool)).toEqual(['create_invoice', 'send_invoice']);
    expect(done).toMatchObject({ status: 'invoiced', invoiceId: 'INV2-TEST-0001', invoiceUrl: 'https://www.sandbox.paypal.com/invoice/p/#TEST' });
    await expect(beginApproval(o.id)).rejects.toThrow(/already has an invoice/);
  });

  it('approve: an agent that changes a price never reaches PayPal', async () => {
    const o = await beginApproval((await draftOrder()).id);
    const paypal = fakePayPal();
    const tampered = structuredClone(invoiceArgsFor(o)) as { items: { unit_amount: { value: string } }[] };
    tampered.items[0].unit_amount.value = '0.01';
    await runApproval(o, { model: scriptedModel([[{ tool: 'create_invoice', input: tampered }], 'I could not create it.']), buildTools: paypal.build, fetchInvoice: sentInvoice });
    const done = (await orders.getOrder(o.id))!;
    expect(paypal.calls).toEqual([]);
    expect(done.status).toBe('failed');
    expect(done.invoiceId).toBeNull();
    const blocked = done.events.find((e) => e.action === GUARDRAIL.priceNotInCatalog)!;
    expect(blocked).toMatchObject({ actor: 'agent', detail: { guardrail: true, catalog_price_usd: '3.20', proposed_price_usd: '0.01', tool: 'create_invoice' } });
  });

  it('guardrail: sending before the owner approves is blocked and logged', async () => {
    const o = await draftOrder(); // a clean draft the owner has NOT approved
    const paypal = fakePayPal();
    await runApproval(o, {
      model: scriptedModel([[{ tool: 'send_invoice', input: { invoice_id: 'INV2-ANY' } }], [{ tool: 'create_invoice', input: invoiceArgsFor(o) }], 'I was not allowed to send it.']),
      buildTools: paypal.build,
      fetchInvoice: sentInvoice,
    });
    const after = (await orders.getOrder(o.id))!;
    expect(paypal.calls).toEqual([]); // nothing reached PayPal
    expect(after.status).toBe('draft'); // still waiting on the owner
    expect(after.invoiceId).toBeNull();
    const blocked = after.events.find((e) => e.action === 'Send invoice blocked: waiting on owner approval')!;
    expect(blocked).toBeDefined();
    expect(blocked.actor).toBe('agent');
    expect(audit.isGuardrail(blocked)).toBe(true);
    expect(actions(after)).toContain(GUARDRAIL.createBeforeApproval);
    expect(actions(after)).not.toContain('Owner approved');
  });

  it('guardrail: a product the AI invents is blocked and logged', async () => {
    const order = await orders.createOrder({ rawText: '10 chef knives', source: 'text' });
    const extracted: ExtractedOrder = {
      customer_name: null,
      delivery_note: null,
      lines: [{ raw_text: '10 chef knives', sku: 'HBR-KNIFE-8', quantity: 10, quantity_unit: 'unit', confidence: 0.9, flags: [], flag_reason: null, candidate_skus: [] }],
    };
    const { resolveOrder } = await import('@/lib/pricing');
    const parsed = resolveOrder(extracted);
    await orders.saveParsedOrder(order.id, parsed);
    await audit.logParseResult(order.id, extracted, parsed, 'scripted-model');
    const saved = (await orders.getOrder(order.id))!;
    expect(saved.lines[0].unit_price_cents).toBeNull();
    const blocked = saved.events.find((e) => e.action === GUARDRAIL.productNotInCatalog)!;
    expect(blocked).toMatchObject({ actor: 'agent', detail: { guardrail: true, proposed_sku: 'HBR-KNIFE-8' } });
    expect(actions(saved).some((a) => a.startsWith('Line flagged for review'))).toBe(true);
  });

  it('audit trail: every step of a paid order is logged with its actor', async () => {
    const o = await beginApproval((await draftOrder()).id);
    const paypal = fakePayPal();
    await runApproval(o, {
      model: scriptedModel([[{ tool: 'create_invoice', input: invoiceArgsFor(o) }], [{ tool: 'send_invoice', input: { invoice_id: 'INV2-TEST-0001' } }], 'Done.']),
      buildTools: paypal.build,
      fetchInvoice: sentInvoice,
    });
    await orders.updateOrder(o.id, { invoiceId: 'INV2-AUDIT' });
    await applyWebhookEvent({ id: 'WH-AUDIT', event_type: 'INVOICING.INVOICE.PAID', resource: { invoice: { id: 'INV2-AUDIT' } } });
    const done = (await orders.getOrder(o.id))!;
    const trail = done.events.map((e) => `${e.actor}: ${e.action}`);
    expect(trail).toEqual([
      'agent: Searched catalog: "servilletas"',
      'agent: Searched catalog: "dish soap"',
      'agent: Parsed by AI',
      'agent: Catalog match: 10 × Dispenser napkins (pack of 250)',
      'agent: Catalog match: 4 × Dish soap 1 gal',
      'owner: Owner approved',
      'agent: Invoicing agent started',
      'agent: Draft invoice created',
      'agent: Invoice sent via PayPal',
      'paypal: Invoice 0001 awaiting payment',
      'paypal: Webhook verified: INVOICING.INVOICE.PAID',
      'paypal: Paid',
    ]);
    expect(done.events.some((e) => audit.isGuardrail(e))).toBe(false);
  });

  it('editing a quantity recalculates the line and order totals and logs the edit', async () => {
    const o = await draftOrder(); // 10 napkins at 3.20 + 4 dish soap at 9.75 = 71.00
    const edited = await orders.editOrder(o.id, {
      lines: [
        { raw_text: o.lines[0].raw_text, sku: o.lines[0].sku, qty: 25 },
        { raw_text: o.lines[1].raw_text, sku: o.lines[1].sku, qty: 4 },
      ],
    });
    expect(edited.lines[0]).toMatchObject({ qty: 25, unit_price_cents: 320, line_total_cents: 8000 });
    expect(edited.lines[1].line_total_cents).toBe(3900);
    expect(edited.totalCents).toBe(11900);
    const event = edited.events.find((e) => e.action === 'Owner edited quantity')!;
    expect(event).toMatchObject({ actor: 'owner', detail: { line: 1, from: 10, to: 25, line_total_usd: '80.00', order_total_before_usd: '71.00', order_total_after_usd: '119.00' } });
  });

  it('webhook marks the order paid, and redelivery is harmless', async () => {
    const o = await beginApproval((await draftOrder()).id);
    const paypal = fakePayPal();
    await runApproval(o, {
      model: scriptedModel([[{ tool: 'create_invoice', input: invoiceArgsFor(o) }], [{ tool: 'send_invoice', input: { invoice_id: 'INV2-TEST-0001' } }], 'Done.']),
      buildTools: paypal.build,
      fetchInvoice: sentInvoice,
    });
    const event = { id: 'WH-1', event_type: 'INVOICING.INVOICE.PAID', resource: { invoice: { id: 'INV2-TEST-0001' } } };
    // Earlier tests left orders with the same fake invoice ID; the handler updates whichever it finds first.
    const res = await applyWebhookEvent(event);
    expect(res).toMatchObject({ handled: true, status: 'paid' });
    expect((await orders.getOrder(res.orderId!))!.status).toBe('paid');
    await applyWebhookEvent(event);
    await applyWebhookEvent({ ...event, event_type: 'INVOICING.INVOICE.CANCELLED' });
    expect((await orders.getOrder(res.orderId!))!.status).toBe('paid');
    expect(await applyWebhookEvent({ event_type: 'PAYMENT.SALE.COMPLETED', resource: { id: 'x' } })).toEqual({ handled: false });
  });

  it('refresh pulls the paid status from PayPal', async () => {
    const o = await draftOrder();
    await orders.updateOrder(o.id, { status: 'invoiced', invoiceId: 'INV2-REFRESH' });
    const synced = await syncInvoiceStatus(o.id, 'test', async () => ({ ...(await sentInvoice()), id: 'INV2-REFRESH', status: 'PAID' }));
    expect(synced.status).toBe('paid');
  });
});

describe('paypal helpers', () => {
  it('reads the invoice ID from a link or a full invoice', () => {
    expect(invoiceIdFrom({ href: 'https://api.sandbox.paypal.com/v2/invoicing/invoices/INV2-AB12-CD34', rel: 'self' })).toBe('INV2-AB12-CD34');
    expect(invoiceIdFrom({ id: 'INV2-X' })).toBe('INV2-X');
    expect(invoiceIdFrom('nope')).toBeNull();
  });
  it('summarizes an invoice and maps statuses', () => {
    const s = summarizeInvoice({ id: 'INV2-X', status: 'SENT', detail: { invoice_number: '0007', metadata: { recipient_view_url: 'https://x' } }, amount: { value: '248.50', currency_code: 'USD' } });
    expect(s).toMatchObject({ invoiceNumber: '0007', recipientViewUrl: 'https://x', totalCents: 24850 });
    expect(orderStatusFor('MARKED_AS_PAID')).toBe('paid');
    expect(orderStatusFor('DRAFT')).toBeNull();
  });
  it('extracts the QR PNG from a multipart body', () => {
    expect(extractQrPng('--boundary\r\nContent-Type: image/png\r\n\r\niVBORw0KGgoAAAANS==\r\n--boundary--')).toBe('iVBORw0KGgoAAAANS==');
  });
});
