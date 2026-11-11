import { NextResponse } from 'next/server';
import { syncInvoiceStatus } from '@/lib/approve';
import { fail, type RouteCtx } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Webhook fallback: ask PayPal for the invoice's status now (get_invoice). */
export async function POST(_req: Request, ctx: RouteCtx) {
  try {
    return NextResponse.json({ order: await syncInvoiceStatus((await ctx.params).id, 'refreshed from PayPal') });
  } catch (e) {
    return fail(e);
  }
}
