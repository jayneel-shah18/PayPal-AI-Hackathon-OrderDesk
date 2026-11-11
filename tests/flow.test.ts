import { tool, type ToolSet } from 'ai';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { scriptedModel } from './helpers';

process.env.ORDERDESK_DB = 'memory';
delete process.env.DATABASE_URL;

// Imported after the env is set so the in-memory database is used.
const { beginApproval, invoiceArgsFor, makeApprovalGuard, runApproval, syncInvoiceStatus } = await import('@/lib/approve');
const orders = await import('@/lib/orders');
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
      onTool: (e) => orders.addEvent(order.id, 'tool_call', `Catalog · ${e.tool}`, e),
    },
  );
  await orders.saveParsedOrder(order.id, parsed);
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
    expect(o.events.filter((e) => e.kind === 'tool_call')).toHaveLength(2);
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
