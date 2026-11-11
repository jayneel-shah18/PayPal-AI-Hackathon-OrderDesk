import { addEvent, findOrderByInvoiceId, updateOrder } from './orders';

const STATUS_BY_EVENT: Record<string, 'paid' | 'cancelled'> = {
  'INVOICING.INVOICE.PAID': 'paid',
  'INVOICING.INVOICE.CANCELLED': 'cancelled',
};

type PayPalEvent = { id?: string; event_type?: string; resource?: { id?: string; invoice?: { id?: string } } };

/** Apply an already-verified PayPal webhook event to the matching order. */
export async function applyWebhookEvent(event: PayPalEvent): Promise<{ handled: boolean; orderId?: string; status?: string }> {
  const status = event.event_type ? STATUS_BY_EVENT[event.event_type] : undefined;
  const invoiceId = event.resource?.invoice?.id ?? event.resource?.id;
  if (!status || !invoiceId) return { handled: false };
  const order = await findOrderByInvoiceId(invoiceId);
  if (!order) return { handled: false };
  // Redeliveries are normal; a paid order stays paid.
  if (order.status !== status && order.status !== 'paid') {
    await updateOrder(order.id, { status });
    await addEvent(order.id, 'webhook', `PayPal webhook · ${event.event_type}`, { event_id: event.id, invoice_id: invoiceId });
  }
  return { handled: true, orderId: order.id, status };
}
