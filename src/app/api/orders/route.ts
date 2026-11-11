import { NextResponse } from 'next/server';
import { fail } from '@/lib/http';
import { listOrders } from '@/lib/orders';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ orders: await listOrders() });
  } catch (e) {
    return fail(e);
  }
}
