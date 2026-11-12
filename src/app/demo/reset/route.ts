import { NextResponse } from 'next/server';
import { fail } from '@/lib/http';
import { demoModeEnabled, resetDemo } from '@/lib/seed';

export const dynamic = 'force-dynamic';

/**
 * Put the demo back to its starting state. Refused unless DEMO_MODE is on.
 * Database only: no PayPal call is made and no PayPal invoice is touched.
 */
export async function POST() {
  if (!demoModeEnabled()) return NextResponse.json({ error: 'Reset is only available in demo mode (DEMO_MODE=true).' }, { status: 403 });
  try {
    return NextResponse.json({ ok: true, ...(await resetDemo()) });
  } catch (e) {
    return fail(e);
  }
}
