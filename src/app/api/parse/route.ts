import { after, NextResponse } from 'next/server';
import { fail } from '@/lib/http';
import { logEvent, logParseResult } from '@/lib/audit';
import { MODEL_ID } from '@/lib/model';
import { createOrder, HttpError, parseReceivedAt, saveParsedOrder, updateOrder } from '@/lib/orders';
import type { ExtractedOrder } from '@/lib/schema';
import { parseOrder } from '@/lib/parse';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_TEXT = 8000;
const MAX_IMAGE_BASE64 = 7_000_000; // about 5 MB of image
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/**
 * Start parsing an order. Responds at once with the order ID; the agent keeps
 * working after the response, and the review screen shows its steps as they land.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { text?: unknown; image?: unknown; customerId?: unknown; receivedAt?: unknown } | null;
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    let image: { base64: string; mediaType: string } | undefined;
    if (typeof body?.image === 'string' && body.image) {
      const m = body.image.match(/^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=]+)$/);
      if (!m || !IMAGE_TYPES.includes(m[1])) throw new HttpError(400, 'Photo must be a PNG, JPEG, WebP or GIF.');
      if (m[2].length > MAX_IMAGE_BASE64) throw new HttpError(413, 'Photo is too large (5 MB max).');
      image = { mediaType: m[1], base64: m[2] };
    }
    if (!text && !image) throw new HttpError(400, 'Paste an order or attach a photo.');
    if (text.length > MAX_TEXT) throw new HttpError(413, `Order text is too long (${MAX_TEXT} characters max).`);
    if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(503, 'ANTHROPIC_API_KEY is not set on the server.');

    const order = await createOrder({
      rawText: text || '[Photo of a handwritten order]',
      source: image ? 'photo' : 'text',
      // Inbox messages arrive with a known sender and a received time; a pasted order has neither.
      customerId: typeof body?.customerId === 'string' && body.customerId ? body.customerId : null,
      receivedAt: parseReceivedAt(body?.receivedAt),
    });
    await logEvent(order.id, 'agent', 'Message received', { channel: image ? 'photo' : 'text', from: order.recipientName ?? 'not yet known' });

    after(async () => {
      try {
        let extracted: ExtractedOrder | undefined;
        const parsed = await parseOrder(
          { text, image },
          {
            onTool: (e) => logEvent(order.id, 'agent', `Searched catalog: "${(e.input as { query?: string }).query ?? ''}"`, { tool: e.tool, matches: e.output }),
            onExtracted: (x) => {
              extracted = x;
            },
          },
        );
        await saveParsedOrder(order.id, parsed);
        await logParseResult(order.id, extracted, parsed, MODEL_ID);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await updateOrder(order.id, { status: 'failed', error: message });
        await logEvent(order.id, 'agent', 'Could not read the order', { error: message });
      }
    });

    return NextResponse.json({ id: order.id }, { status: 202 });
  } catch (e) {
    return fail(e);
  }
}
