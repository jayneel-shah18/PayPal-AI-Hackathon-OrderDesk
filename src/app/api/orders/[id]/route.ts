import { NextResponse } from 'next/server';
import { z } from 'zod';
import { fail, type RouteCtx } from '@/lib/http';
import { editOrder, getOrder, HttpError } from '@/lib/orders';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: RouteCtx) {
  try {
    const order = await getOrder((await ctx.params).id);
    if (!order) throw new HttpError(404, 'Order not found');
    return NextResponse.json({ order });
  } catch (e) {
    return fail(e);
  }
}

const PatchSchema = z.object({
  customerId: z.string().nullable().optional(),
  recipientName: z.string().max(200).nullable().optional(),
  recipientEmail: z.string().max(200).nullable().optional(),
  deliveryNote: z.string().max(500).nullable().optional(),
  lines: z
    .array(
      z.object({
        raw_text: z.string().max(500),
        sku: z.string().max(40).nullable(),
        qty: z.number().nullable(),
        // Flags the owner has not yet dealt with on an untouched line. Edited lines send none.
        flags: z.array(z.string()).optional(),
        flag_reason: z.string().max(500).nullable().optional(),
        candidate_skus: z.array(z.string()).optional(),
      }),
    )
    .max(100)
    .optional(),
});

export async function PATCH(req: Request, ctx: RouteCtx) {
  try {
    const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, 'Invalid edit.');
    return NextResponse.json({ order: await editOrder((await ctx.params).id, parsed.data) });
  } catch (e) {
    return fail(e);
  }
}
