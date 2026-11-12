import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getCatalog } from '@/lib/catalog';
import { fail } from '@/lib/http';
import { MODEL_ID } from '@/lib/model';
import { listCustomers } from '@/lib/orders';
import { paypalConfigured } from '@/lib/paypal';
import { demoModeEnabled } from '@/lib/seed';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const samples = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'sample-orders.json'), 'utf8'));
    return NextResponse.json({
      samples,
      customers: await listCustomers(),
      catalog: getCatalog().map((i) => ({ sku: i.sku, name: i.name, unit: i.unit, packSize: i.packSize, priceCents: i.priceCents, stock: i.stock })),
      config: {
        model: MODEL_ID,
        claude: !!process.env.ANTHROPIC_API_KEY,
        paypal: paypalConfigured(),
        webhook: !!process.env.PAYPAL_WEBHOOK_ID,
        demoMode: demoModeEnabled(),
      },
    });
  } catch (e) {
    return fail(e);
  }
}
