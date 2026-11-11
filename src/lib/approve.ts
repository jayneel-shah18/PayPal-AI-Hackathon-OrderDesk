import { generateText, isStepCount, type LanguageModel, type ToolSet } from 'ai';
import { getModel } from './model';
import { addEvent, getOrder, HttpError, type OrderDetail, updateOrder } from './orders';
import { getInvoice, invoiceIdFrom, orderStatusFor, paypalAgentTools, type PayPalToolName, type ToolGuard, type ToolObserver } from './paypal';

export const APPROVE_SYSTEM = `You are the invoicing agent for a small distributor. The owner has reviewed and approved an order. Bill it through PayPal with the tools you have.

Do exactly this:
1. Call create_invoice once, with the approved order copied exactly: the same items, quantities and unit prices, in the same order, and the given currency, recipient, reference and note. Do not add tax, discounts, shipping or tips, and do not change a name or a number.
2. Call send_invoice with the invoice ID that create_invoice returned.
3. Call get_invoice for that ID to confirm it was sent.

If a tool returns an error, read it and fix the call once. If it still fails, stop and say what went wrong. Finish with one sentence stating the invoice ID and its status.`;

/** The exact create_invoice arguments the owner approved. Built in code, never by the model. */
export function invoiceArgsFor(order: OrderDetail): Record<string, unknown> {
  const args: Record<string, unknown> = {
    currency_code: 'USD',
    reference: order.id,
    primary_recipients: [{ billing_info: { business_name: order.recipientName, email_address: order.recipientEmail } }],
    items: order.lines.map((l) => ({
      name: `${l.name} (${l.sku})`,
      quantity: String(l.qty),
      unit_amount: { currency_code: 'USD', value: (l.unit_price_cents! / 100).toFixed(2) },
    })),
  };
  if (order.deliveryNote) args.note = `Delivery: ${order.deliveryNote}`;
  if (process.env.PAYPAL_INVOICER_EMAIL) args.invoicer_email_address = process.env.PAYPAL_INVOICER_EMAIL;
  args.invoicer_business_name = process.env.ORDERDESK_BUSINESS_NAME || 'OrderDesk Supply Co.';
  return args;
}

type InvoiceItemArg = { name?: string; quantity?: string; unit_amount?: { currency_code?: string; value?: string }; tax?: unknown; discount?: unknown };

/** Total in cents of the items the agent is about to send to PayPal, or null if malformed. */
export function itemsTotalCents(items: unknown): number | null {
  if (!Array.isArray(items)) return null;
  let total = 0;
  for (const it of items as InvoiceItemArg[]) {
    const qty = Number(it?.quantity);
    const cents = Math.round(Number(it?.unit_amount?.value) * 100);
    if (!Number.isInteger(qty) || qty <= 0 || !Number.isFinite(cents)) return null;
    total += qty * cents;
  }
  return total;
}

/**
 * The human-approval boundary, enforced in code rather than in the prompt:
 * the agent may create one invoice whose lines match what was approved, and
 * may only send the invoice it just created.
 */
export function makeApprovalGuard(order: Pick<OrderDetail, 'lines' | 'totalCents' | 'recipientEmail'>, state: { invoiceId: string | null }): ToolGuard {
  return (name, input) => {
    if (name === 'create_invoice') {
      if (state.invoiceId) return `An invoice (${state.invoiceId}) was already created for this order. Do not create another.`;
      if (input.currency_code !== 'USD') return 'Currency must be USD.';
      const items = input.items as InvoiceItemArg[] | undefined;
      if (!Array.isArray(items) || items.length !== order.lines.length) return `The approved order has ${order.lines.length} line(s). Send exactly those.`;
      if (items.some((i) => i.tax || i.discount)) return 'Do not add tax or discounts.';
      if (input.shipping_cost || input.allow_tip) return 'Do not add shipping or tips.';
      for (let i = 0; i < items.length; i++) {
        const want = order.lines[i];
        const cents = Math.round(Number(items[i]?.unit_amount?.value) * 100);
        if (Number(items[i]?.quantity) !== want.qty || cents !== want.unit_price_cents) {
          return `Line ${i + 1} differs from the approved order (expected ${want.qty} x ${(want.unit_price_cents! / 100).toFixed(2)} for ${want.sku}).`;
        }
      }
      if (itemsTotalCents(items) !== order.totalCents) return 'Invoice total differs from the approved total.';
      const recipients = input.primary_recipients as { billing_info?: { email_address?: string } }[] | undefined;
      if (!Array.isArray(recipients) || recipients.length !== 1 || recipients[0]?.billing_info?.email_address !== order.recipientEmail) {
        return `Bill exactly one recipient: ${order.recipientEmail}.`;
      }
      return null;
    }
    if (name === 'send_invoice') {
      if (!state.invoiceId) return 'Create the invoice first.';
      if (input.invoice_id !== state.invoiceId) return `Only invoice ${state.invoiceId} may be sent.`;
      if (Array.isArray(input.additional_recipients) && input.additional_recipients.length) return 'Do not add recipients.';
      return null;
    }
    if (name === 'get_invoice') return state.invoiceId && input.invoice_id !== state.invoiceId ? `Only invoice ${state.invoiceId} is in scope.` : null;
    return `${name} is not part of approving an order.`;
  };
}

const APPROVE_TOOLS: PayPalToolName[] = ['create_invoice', 'send_invoice', 'get_invoice'];

export type ApproveDeps = {
  model?: LanguageModel;
  /** Test seam: replaces the PayPal toolkit tools. */
  buildTools?: (hooks: { guard: ToolGuard; observe: ToolObserver }) => ToolSet;
  /** Test seam: replaces the final get_invoice lookup. */
  fetchInvoice?: typeof getInvoice;
};

/** Mark an order as being sent. Throws if it is not ready; this is the gate behind the Approve button. */
export async function beginApproval(orderId: string): Promise<OrderDetail> {
  const order = await getOrder(orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  if (order.invoiceId) throw new HttpError(409, 'This order already has an invoice.');
  if (order.status === 'needs_info' && order.blocker) throw new HttpError(422, order.blocker);
  if (order.status !== 'draft' && order.status !== 'failed') throw new HttpError(409, `Order is ${order.status}; only a clean draft can be approved.`);
  if (order.blocker) throw new HttpError(422, order.blocker);
  await updateOrder(orderId, { status: 'sending', error: null });
  await addEvent(orderId, 'step', 'Owner approved the order', { total_cents: order.totalCents, recipient: order.recipientEmail });
  return order;
}

/** Run the invoicing agent for an approved order: create, send, confirm. */
export async function runApproval(order: OrderDetail, deps: ApproveDeps = {}): Promise<void> {
  const state: { invoiceId: string | null; sent: boolean } = { invoiceId: null, sent: false };
  const guard = makeApprovalGuard(order, state);
  const observe: ToolObserver = async (e) => {
    if (e.tool === 'create_invoice' && !e.error) {
      state.invoiceId = invoiceIdFrom(e.output);
      // Persist immediately, so a crash after this point cannot lead to a second invoice.
      if (state.invoiceId) await updateOrder(order.id, { invoiceId: state.invoiceId });
    }
    if (e.tool === 'send_invoice' && !e.error) state.sent = true;
    await addEvent(order.id, e.error ? 'error' : 'tool_call', `PayPal · ${e.tool}`, { input: e.input, ...(e.error ? { error: e.error } : { output: e.output }) });
  };

  try {
    await addEvent(order.id, 'step', 'Invoicing agent started (PayPal Agent Toolkit, sandbox)');
    const result = await generateText({
      model: deps.model ?? getModel(),
      system: APPROVE_SYSTEM,
      prompt: `Approved order ${order.id}. Use these create_invoice arguments exactly:\n\n${JSON.stringify(invoiceArgsFor(order), null, 2)}`,
      tools: deps.buildTools ? deps.buildTools({ guard, observe }) : paypalAgentTools(APPROVE_TOOLS, { guard, observe }),
      stopWhen: isStepCount(8),
      providerOptions: { anthropic: { effort: 'low' } },
    });

    if (!state.invoiceId) throw new Error(`The agent did not create an invoice. ${result.text}`.trim());
    if (!state.sent) throw new Error(`Invoice ${state.invoiceId} was created as a draft but not sent. ${result.text}`.trim());

    const invoice = await (deps.fetchInvoice ?? getInvoice)(state.invoiceId);
    if (invoice.totalCents != null && invoice.totalCents !== order.totalCents) {
      throw new Error(`PayPal invoice total (${invoice.totalCents}) does not match the approved total (${order.totalCents}).`);
    }
    await updateOrder(order.id, {
      status: orderStatusFor(invoice.status) ?? 'invoiced',
      invoiceId: state.invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      invoiceUrl: invoice.recipientViewUrl,
    });
    await addEvent(order.id, 'step', `Invoice ${invoice.invoiceNumber ?? state.invoiceId} sent`, { status: invoice.status, payer_link: invoice.recipientViewUrl });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await updateOrder(order.id, { status: 'failed', error: message });
    await addEvent(order.id, 'error', 'Invoicing failed', { error: message });
  }
}

/** Pull the invoice's current status from PayPal (the Refresh button, and the webhook's source of truth). */
export async function syncInvoiceStatus(orderId: string, via: string, fetchInvoice: typeof getInvoice = getInvoice): Promise<OrderDetail> {
  const order = await getOrder(orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  if (!order.invoiceId) throw new HttpError(409, 'This order has no invoice yet.');
  const invoice = await fetchInvoice(order.invoiceId);
  const status = orderStatusFor(invoice.status);
  const patch: Parameters<typeof updateOrder>[1] = {};
  if (status && status !== order.status) patch.status = status;
  if (invoice.recipientViewUrl && invoice.recipientViewUrl !== order.invoiceUrl) patch.invoiceUrl = invoice.recipientViewUrl;
  if (invoice.invoiceNumber && invoice.invoiceNumber !== order.invoiceNumber) patch.invoiceNumber = invoice.invoiceNumber;
  if (Object.keys(patch).length) await updateOrder(orderId, patch);
  if (patch.status) await addEvent(orderId, 'step', `Marked ${patch.status} (${via})`, { paypal_status: invoice.status });
  return (await getOrder(orderId))!;
}
