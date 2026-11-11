/**
 * The seven sample orders against the real model. Costs a few cents per run.
 *   ANTHROPIC_API_KEY=... npm run test:live
 * Skipped when no key is set, so `npm test` stays offline and free.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseOrder } from '@/lib/parse';

const samples = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'sample-orders.json'), 'utf8')) as { id: string; text: string; image?: string }[];
const text = (id: string) => samples.find((s) => s.id === id)!.text;
const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

live('parser on the sample orders (live model)', () => {
  it('clean: 40 sleeves of cups and 5 boxes of filters for Main St Cafe', async () => {
    const o = await parseOrder({ text: text('clean') });
    expect(o.lines.map((l) => [l.sku, l.qty])).toEqual([
      ['HBR-CUP-12', 40],
      ['HBR-FLT-12', 5],
    ]);
    expect(o.total_cents).toBe(21250);
    expect(o.customer_name).toMatch(/main st/i);
    expect(o.needs_info).toBe(false);
  });

  it('spanish/english: servilletas and dish soap, with a delivery note', async () => {
    const o = await parseOrder({ text: text('spanglish') });
    expect(o.lines.map((l) => [l.sku, l.qty])).toEqual([
      ['HBR-NAP-DISP', 10],
      ['BRT-DSH-1G', 4],
    ]);
    expect(o.total_cents).toBe(7100);
    expect(o.customer_name).toMatch(/rosa/i);
    expect(o.delivery_note).toBeTruthy();
    expect(o.needs_info).toBe(false);
  });

  it('ambiguous: asks instead of guessing', async () => {
    const o = await parseOrder({ text: text('ambiguous') });
    expect(o.needs_info).toBe(true);
    const cups = o.lines[0];
    expect(cups.sku).toBeNull();
    expect(cups.candidates.length).toBeGreaterThanOrEqual(2);
    const napkins = o.lines.find((l) => l.sku === 'HBR-NAP-DISP' || /napkin/i.test(l.raw_text))!;
    expect(napkins.qty).toBeNull();
    expect(o.lines.some((l) => l.flags.includes('needs_history'))).toBe(true);
    expect(o.total_cents).toBe(0);
  });

  it('out of stock: 30 small to-go containers against 25 in stock', async () => {
    const o = await parseOrder({ text: text('out_of_stock') });
    expect(o.lines[0]).toMatchObject({ sku: 'HBR-CLAM-6', qty: 30 });
    expect(o.lines[0].flags).toContain('out_of_stock');
  });

  it('unknown item: flags the knives, prices the sanitizer', async () => {
    const o = await parseOrder({ text: text('unknown_item') });
    const knives = o.lines.find((l) => /kni(fe|ves)/i.test(l.raw_text))!;
    expect(knives.sku).toBeNull();
    expect(knives.flags).toContain('not_in_catalog');
    expect(o.lines.find((l) => l.sku === 'BRT-SAN-1G')).toMatchObject({ qty: 3, line_total_cents: 4200 });
    expect(o.total_cents).toBe(4200);
  });

  it('photo: reads the handwritten list', async () => {
    const file = path.join(process.cwd(), 'public', samples.find((s) => s.id === 'photo')!.image!);
    const o = await parseOrder({ image: { base64: fs.readFileSync(file).toString('base64'), mediaType: 'image/png' } });
    expect(o.lines.map((l) => [l.sku, l.qty])).toEqual([
      ['HBR-CUP-12', 40],
      ['HBR-FLT-12', 5],
    ]);
  });

  it('email forward: ignores the signature and the quoted older order', async () => {
    const o = await parseOrder({ text: text('email_forward') });
    expect(o.lines.map((l) => [l.sku, l.qty])).toEqual([
      ['BRT-BAG-33', 40],
      ['GEN-GLV-L', 12],
    ]);
    expect(o.lines.some((l) => l.sku === 'HBR-CUP-16' || l.sku === 'BRT-SAN-1G')).toBe(false);
  });
});
