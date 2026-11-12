import { generateText, isStepCount, type LanguageModel, type ModelMessage, Output, tool } from 'ai';
import { z } from 'zod';
import { type CatalogItem, getCatalog, searchCatalog } from './catalog';
import { getModel } from './model';
import { resolveOrder } from './pricing';
import { type ExtractedOrder, ExtractedOrderSchema, type ParsedOrder } from './schema';

export const PARSE_SYSTEM = `You read incoming orders for a small distributor that supplies restaurants and cafes and turn them into order lines for the owner to review.

Orders arrive as text messages, pasted emails or photos of handwritten lists. They are informal: English, Spanish or a mix of both (servilletas, vasos, jabón, bolsas), no SKUs, loose quantities.

How to work:
- Call search_catalog for every product the customer mentions, using their own words. It is the only source of products. Never use a SKU it did not return.
- One line per requested product. Report the quantity as the customer wrote it and say how they counted. search_catalog returns each product's selling unit (sleeve, pack, box, jug, roll) and how many of those are in a case. Use "case" only when the customer counted in full cases or cartons (cases, cartons, cajas). Use "unit" when they used the product's own selling unit or an everyday word for it (paquetes for packs, galones for one-gallon jugs), or gave a bare number. Do not convert cases to units and do not work out prices: the system does both from the catalog.
- Read only the newest request. In a forwarded or replied email, ignore signatures, contact details and older quoted messages (lines starting with ">" or under "On ... wrote:").
- The owner would rather answer a question than fix a wrong invoice, so do not guess:
  - If a phrase could mean more than one catalog item (for example "cups" when there are several cup sizes), leave sku null, flag "ambiguous" and list the possible SKUs in candidate_skus.
  - If there is no quantity ("some", "a few"), leave quantity null and flag "ambiguous".
  - If search_catalog finds nothing that fits, leave sku null and flag "not_in_catalog". Still keep the line so the owner sees it.
  - If the order leans on past orders ("same as last time", "usual"), flag "needs_history" on the lines it affects.
- Stock is checked by the system. Do not flag stock yourself.
- flag_reason is shown to the owner next to the line: one short, plain sentence saying what to decide.
- customer_name is the shop or person to bill if the order names one. delivery_note carries timing, urgency and ship-to details, translated to plain English.`;

export type ParseInput = {
  text?: string;
  /** Photo of a handwritten order. */
  image?: { base64: string; mediaType: string };
};

export type ToolEvent = { tool: string; input: unknown; output?: unknown; error?: string };

export type ParseOptions = {
  model?: LanguageModel;
  catalog?: CatalogItem[];
  onTool?: (event: ToolEvent) => void | Promise<void>;
  /** Receives the model's raw proposal, before catalog pricing and validation. */
  onExtracted?: (extracted: ExtractedOrder) => void | Promise<void>;
};

/** Model step: messy order in, structured lines out. No prices involved. */
export async function extractOrder(input: ParseInput, opts: ParseOptions = {}): Promise<ExtractedOrder> {
  const catalog = opts.catalog ?? getCatalog();
  const content: Exclude<Extract<ModelMessage, { role: 'user' }>['content'], string> = [];
  if (input.image) {
    content.push({ type: 'file', data: input.image.base64, mediaType: input.image.mediaType });
    content.push({ type: 'text', text: 'This photo is a handwritten order. Read it and extract the order lines.' });
  }
  if (input.text?.trim()) content.push({ type: 'text', text: `Order message:\n\n${input.text.trim()}` });
  if (content.length === 0) throw new Error('Nothing to parse: give order text or a photo.');

  const result = await generateText({
    model: opts.model ?? getModel(),
    system: PARSE_SYSTEM,
    messages: [{ role: 'user', content }],
    tools: {
      search_catalog: tool({
        description:
          'Search the product catalog by the customer\'s own words (product names, brand, Spanish names, sizes). Returns up to 5 matches with sku, name, unit, pack_size (units per case), price and stock, best first. Several similar scores mean the phrase is ambiguous.',
        inputSchema: z.object({ query: z.string().describe('The product phrase as the customer wrote it, e.g. "servilletas" or "small to-go containers".') }),
        execute: async ({ query }) => {
          const matches = searchCatalog(query, catalog);
          await opts.onTool?.({ tool: 'search_catalog', input: { query }, output: matches.map((m) => `${m.sku} (${m.score})`) });
          return matches.length ? { matches } : { matches: [], note: 'No catalog item matches this phrase.' };
        },
      }),
    },
    stopWhen: isStepCount(12),
    output: Output.object({ schema: ExtractedOrderSchema }),
    providerOptions: { anthropic: { effort: 'medium' } },
  });
  return result.output;
}

/** Full parse: model extraction, then catalog pricing and validation in code. */
export async function parseOrder(input: ParseInput, opts: ParseOptions = {}): Promise<ParsedOrder> {
  const extracted = await extractOrder(input, opts);
  await opts.onExtracted?.(extracted);
  return resolveOrder(extracted, opts.catalog ?? getCatalog());
}
