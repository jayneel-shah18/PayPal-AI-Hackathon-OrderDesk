import { NextResponse } from 'next/server';
import { fail, type RouteCtx } from '@/lib/http';
import { logEvent } from '@/lib/audit';
import { getOrder, HttpError } from '@/lib/orders';
import { callPayPalTool } from '@/lib/paypal';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: RouteCtx) {
  try {
    const order = await getOrder((await ctx.params).id);
    if (!order) throw new HttpError(404, 'Order not found');
    if (!order.invoiceId || order.status !== 'invoiced') throw new HttpError(409, 'Only a sent, unpaid invoice can be reminded.');
    await callPayPalTool('send_invoice_reminder', {
      invoice_id: order.invoiceId,
      subject: `Reminder: invoice ${order.invoiceNumber ?? ''}`.trim(),
      note: 'A friendly reminder that this invoice is awaiting payment.',
    });
    await logEvent(order.id, 'owner', 'Owner sent a payment reminder', { invoice_id: order.invoiceId, tool: 'send_invoice_reminder' });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
