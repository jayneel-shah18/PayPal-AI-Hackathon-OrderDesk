import { NextResponse } from 'next/server';
import { verifyWebhookSignature } from '@/lib/paypal';
import { applyWebhookEvent } from '@/lib/webhook';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const raw = await req.text();
  let verified = false;
  try {
    verified = await verifyWebhookSignature(req.headers, raw);
  } catch (e) {
    console.error('Webhook verification error', e);
    // 500 so PayPal retries once configuration is fixed.
    return NextResponse.json({ error: 'Webhook verification is not configured' }, { status: 500 });
  }
  if (!verified) return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  try {
    const result = await applyWebhookEvent(JSON.parse(raw));
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('Webhook handling error', e);
    return NextResponse.json({ error: 'Could not apply event' }, { status: 500 });
  }
}
