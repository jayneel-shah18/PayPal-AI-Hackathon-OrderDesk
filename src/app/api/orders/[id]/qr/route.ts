import { NextResponse } from 'next/server';
import { fail, type RouteCtx } from '@/lib/http';
import { logEvent } from '@/lib/audit';
import { getOrder, HttpError } from '@/lib/orders';
import { callPayPalTool, extractQrPng } from '@/lib/paypal';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: RouteCtx) {
  try {
    const order = await getOrder((await ctx.params).id);
    if (!order) throw new HttpError(404, 'Order not found');
    if (!order.invoiceId) throw new HttpError(409, 'This order has no invoice yet.');
    const result = await callPayPalTool('generate_invoice_qr_code', { invoice_id: order.invoiceId, width: 300, height: 300 });
    const png = extractQrPng(result);
    if (!png) throw new HttpError(502, 'PayPal did not return a QR image.');
    await logEvent(order.id, 'owner', 'Owner generated a QR code', { invoice_id: order.invoiceId, tool: 'generate_invoice_qr_code' });
    return NextResponse.json({ image: `data:image/png;base64,${png}` });
  } catch (e) {
    return fail(e);
  }
}
