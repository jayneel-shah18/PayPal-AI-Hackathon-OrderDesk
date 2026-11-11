import { after, NextResponse } from 'next/server';
import { beginApproval, runApproval } from '@/lib/approve';
import { fail, type RouteCtx } from '@/lib/http';
import { HttpError } from '@/lib/orders';
import { paypalConfigured } from '@/lib/paypal';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** The only path from an order to PayPal. Nothing is created or sent before this is called. */
export async function POST(_req: Request, ctx: RouteCtx) {
  try {
    if (!paypalConfigured()) throw new HttpError(503, 'PayPal sandbox credentials are not set on the server.');
    if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(503, 'ANTHROPIC_API_KEY is not set on the server.');
    const order = await beginApproval((await ctx.params).id);
    after(() => runApproval(order));
    return NextResponse.json({ id: order.id, status: 'sending' }, { status: 202 });
  } catch (e) {
    return fail(e);
  }
}
