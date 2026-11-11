import fs from 'node:fs';
import path from 'node:path';

export type CatalogItem = {
  sku: string;
  name: string;
  brand: string;
  /** What one sellable unit is called: "sleeve", "pack", "box", "jug" or "roll". */
  unit: string;
  /** Units per case. */
  packSize: number;
  priceCents: number;
  stock: number;
  aliases: string[];
};

/** Minimal RFC 4180 CSV parser: handles quoted fields and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

export function parseCatalog(csv: string): CatalogItem[] {
  const [header, ...rows] = parseCsv(csv);
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`catalog.csv is missing column "${name}"`);
    return i;
  };
  const c = {
    sku: col('sku'),
    name: col('name'),
    brand: col('brand'),
    unit: col('unit'),
    pack: col('pack_size'),
    price: col('price_usd'),
    stock: col('stock'),
    aliases: col('aliases'),
  };
  return rows.map((r) => ({
    sku: r[c.sku].trim(),
    name: r[c.name].trim(),
    brand: r[c.brand].trim(),
    unit: r[c.unit].trim(),
    packSize: Number(r[c.pack]),
    priceCents: Math.round(Number(r[c.price]) * 100),
    stock: Number(r[c.stock]),
    aliases: r[c.aliases]
      .split('|')
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean),
  }));
}

let cached: CatalogItem[] | undefined;

export function getCatalog(): CatalogItem[] {
  if (!cached) {
    const file = path.join(process.cwd(), 'data', 'catalog.csv');
    cached = parseCatalog(fs.readFileSync(file, 'utf8'));
  }
  return cached;
}

export function findSku(sku: string | null | undefined, catalog = getCatalog()): CatalogItem | undefined {
  if (!sku) return undefined;
  const wanted = sku.trim().toUpperCase();
  return catalog.find((i) => i.sku.toUpperCase() === wanted);
}

const STOP = new Set(['a', 'an', 'the', 'of', 'and', 'some', 'for', 'y', 'de', 'la', 'el', 'los', 'las', 'unos', 'unas', 'pcs', 'pieces', 'piece']);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // "jabón" matches "jabon"
    .replace(/(\d)\s*(oz|gal|in)\b/g, '$1 $2') // "12oz" matches "12 oz"
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && !STOP.has(t))
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t));
}

export type CatalogMatch = {
  sku: string;
  name: string;
  brand: string;
  unit: string;
  pack_size: number;
  price_usd: string;
  stock: number;
  aliases: string[];
  score: number;
};

/**
 * Fuzzy lookup of messy words ("servilletas", "small to-go boxes", "12oz cups") against
 * catalog names, brands, SKUs and aliases. Returns the best matches, highest
 * score first. Several close scores mean the phrase is ambiguous.
 */
export function searchCatalog(query: string, catalog = getCatalog(), limit = 5): CatalogMatch[] {
  const q = tokens(query);
  if (q.length === 0) return [];
  const qJoined = q.join(' ');
  const scored = catalog.map((item) => {
    let score = 0;
    for (const alias of item.aliases) {
      const a = tokens(alias);
      const aJoined = a.join(' ');
      if (aJoined === qJoined) score = Math.max(score, 0.95);
      else if (a.length && a.every((t) => q.includes(t))) score = Math.max(score, 0.9);
      else if (q.every((t) => a.includes(t))) score = Math.max(score, 0.7);
    }
    const hay = new Set([...tokens(item.name), ...tokens(item.brand), ...tokens(item.sku), ...item.aliases.flatMap(tokens)]);
    const hits = q.filter((t) => hay.has(t)).length;
    // Coverage across name, brand and aliases breaks ties between items that share an alias.
    const coverage = hits / q.length;
    score = Math.min(1, Math.max(score, coverage * 0.6) + coverage * 0.1);
    return { item, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item, score }) => ({
      sku: item.sku,
      name: item.name,
      brand: item.brand,
      unit: item.unit,
      pack_size: item.packSize,
      price_usd: (item.priceCents / 100).toFixed(2),
      stock: item.stock,
      aliases: item.aliases,
      score: Math.round(score * 100) / 100,
    }));
}
