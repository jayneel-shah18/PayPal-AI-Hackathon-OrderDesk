import { describe, expect, it } from 'vitest';
import { getCatalog, parseCsv, searchCatalog } from '@/lib/catalog';

describe('catalog', () => {
  it('parses quoted CSV fields', () => {
    expect(parseCsv('a,b\n1,"x, ""y"""\n')).toEqual([
      ['a', 'b'],
      ['1', 'x, "y"'],
    ]);
  });

  it('loads all twelve items with integer cents', () => {
    const c = getCatalog();
    expect(c).toHaveLength(12);
    expect(c.find((i) => i.sku === 'HBR-CUP-12')).toMatchObject({ priceCents: 450, packSize: 20, stock: 400, unit: 'sleeve' });
  });

  it.each([
    ['servilletas', 'HBR-NAP-DISP'],
    ['napkins', 'HBR-NAP-DISP'],
    ['12 oz hot cups', 'HBR-CUP-12'],
    ['12oz cups', 'HBR-CUP-12'],
    ['16 oz cups', 'HBR-CUP-16'],
    ['coffee filters', 'HBR-FLT-12'],
    ['dish soap', 'BRT-DSH-1G'],
    ['jabón para platos', 'BRT-DSH-1G'],
    ['small to-go containers', 'HBR-CLAM-6'],
    ['to-go containers', 'HBR-CLAM-9'],
    ['sanitizer', 'BRT-SAN-1G'],
    ['33 gallon trash bags', 'BRT-BAG-33'],
    ['large gloves', 'GEN-GLV-L'],
    ['guantes', 'GEN-GLV-L'],
  ])('finds %s', (query, sku) => {
    expect(searchCatalog(query)[0]?.sku).toBe(sku);
  });

  it('returns both cup sizes for a bare "cups"', () => {
    const skus = searchCatalog('cups').map((m) => m.sku);
    expect(skus).toEqual(expect.arrayContaining(['HBR-CUP-12', 'HBR-CUP-16']));
  });

  it('finds nothing for an item we do not sell', () => {
    expect(searchCatalog('chef knives')).toEqual([]);
  });
});
