import { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk';
import { tool, type ToolSet } from 'ai';
import type { z } from 'zod';

/** Invoice tools we enable from the PayPal Agent Toolkit. Nothing else is exposed to the agent. */
export const INVOICE_ACTIONS = {
  create: true,
  send: true,
  get: true,
  list: true,
  sendReminder: true,
  generateQRC: true,
  cancel: true,
} as const;

export type PayPalToolName =
  | 'create_invoice'
  | 'send_invoice'
  | 'get_invoice'
  | 'list_invoices'
  | 'send_invoice_reminder'
  | 'generate_invoice_qr_code'
  | 'cancel_sent_invoice';

type ToolkitTool = {
  description: string;
  parameters: z.ZodTypeAny;
  execute: (args: unknown, options: unknown) => Promise<unknown>;
};

let toolkit: PayPalAgentToolkit | undefined;

export function paypalConfigured(): boolean {
  return !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

export function getToolkit(): PayPalAgentToolkit {
  if (!paypalConfigured()) {
    throw new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are not set (sandbox REST app credentials, see .env.example).');
  }
  toolkit ??= new PayPalAgentToolkit({
    clientId: process.env.PAYPAL_CLIENT_ID!,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
    // Sandbox is hard-wired: this app never talks to live PayPal.
    configuration: { actions: { invoices: { ...INVOICE_ACTIONS } }, context: { sandbox: true } },
  });
  return toolkit;
}

function toolkitTools(): Record<string, ToolkitTool> {
  return getToolkit().getTools() as unknown as Record<string, ToolkitTool>;
}

function normalize(result: unknown): unknown {
  if (typeof result !== 'string') return result;
  try {
    return JSON.parse(result);
  } catch {
    return result;
  }
}

/** The toolkit reports API failures as a result payload, not an exception. */
export function paypalError(result: unknown): string | null {
  if (typeof result === 'string') return /error|fail/i.test(result) ? result : null;
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (r.error) return typeof r.error === 'string' ? r.error : JSON.stringify(r.error);
    if (typeof r.name === 'string' && typeof r.message === 'string' && (r.debug_id || r.details)) return `${r.name}: ${r.message}`;
  }
  return null;
}

/** Call one toolkit tool directly from code (Refresh, Remind, QR, scripts). */
export async function callPayPalTool(name: PayPalToolName, args: Record<string, unknown>): Promise<unknown> {
  const t = toolkitTools()[name];
  if (!t) throw new Error(`PayPal tool ${name} is not enabled`);
  const result = normalize(await t.execute(t.parameters.parse(args), { toolCallId: `direct_${name}`, messages: [] }));
  const err = paypalError(result);
  if (err) throw new Error(`PayPal ${name} failed: ${err}`);
  return result;
}

export type ToolGuard = (name: PayPalToolName, input: Record<string, unknown>) => string | null | Promise<string | null>;
export type ToolObserver = (e: { tool: PayPalToolName; input: unknown; output?: unknown; error?: string }) => void | Promise<void>;

/**
 * Toolkit tools re-wrapped for the current AI SDK, with two hooks:
 * `guard` can refuse a call before it reaches PayPal, `observe` records every call.
 */
export function paypalAgentTools(names: PayPalToolName[], hooks: { guard?: ToolGuard; observe?: ToolObserver } = {}): ToolSet {
  const source = toolkitTools();
  const out: ToolSet = {};
  for (const name of names) {
    const t = source[name];
    if (!t) throw new Error(`PayPal tool ${name} is not enabled`);
    out[name] = tool({
      description: t.description,
      inputSchema: t.parameters as z.ZodType<Record<string, unknown>>,
      execute: async (input: Record<string, unknown>) => {
        const refusal = await hooks.guard?.(name, input);
        if (refusal) {
          await hooks.observe?.({ tool: name, input, error: `Blocked: ${refusal}` });
          return { error: refusal };
        }
        try {
          const output = normalize(await t.execute(input, { toolCallId: name, messages: [] }));
          const err = paypalError(output);
          await hooks.observe?.({ tool: name, input, output, ...(err ? { error: err } : {}) });
          return output;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          await hooks.observe?.({ tool: name, input, error: message });
          return { error: message };
        }
      },
    });
  }
  return out;
}

/** Pull the invoice ID out of a create_invoice result (full invoice, or just a link to it). */
export function invoiceIdFrom(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  if (typeof r.id === 'string') return r.id;
  const href = typeof r.href === 'string' ? r.href : undefined;
  const links = Array.isArray(r.links) ? (r.links as { href?: string; rel?: string }[]) : [];
  const candidate = href ?? links.find((l) => l.rel === 'self')?.href ?? links[0]?.href;
  const m = candidate?.match(/\/invoices\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export type InvoiceSummary = {
  id: string;
  status: string; // DRAFT | SENT | PAID | MARKED_AS_PAID | CANCELLED | ...
  invoiceNumber: string | null;
  recipientViewUrl: string | null;
  totalCents: number | null;
  currency: string | null;
};

export function summarizeInvoice(raw: unknown): InvoiceSummary {
  const inv = (raw ?? {}) as {
    id?: string;
    status?: string;
    detail?: { invoice_number?: string; metadata?: { recipient_view_url?: string } };
    amount?: { value?: string; currency_code?: string };
  };
  const value = inv.amount?.value;
  return {
    id: inv.id ?? '',
    status: inv.status ?? 'UNKNOWN',
    invoiceNumber: inv.detail?.invoice_number ?? null,
    recipientViewUrl: inv.detail?.metadata?.recipient_view_url ?? null,
    totalCents: value != null && value !== '' ? Math.round(Number(value) * 100) : null,
    currency: inv.amount?.currency_code ?? null,
  };
}

export async function getInvoice(invoiceId: string): Promise<InvoiceSummary> {
  return summarizeInvoice(await callPayPalTool('get_invoice', { invoice_id: invoiceId }));
}

/** PayPal invoice status mapped to an order status, or null to leave the order as it is. */
export function orderStatusFor(invoiceStatus: string): 'invoiced' | 'paid' | 'cancelled' | null {
  switch (invoiceStatus) {
    case 'PAID':
    case 'MARKED_AS_PAID':
      return 'paid';
    case 'CANCELLED':
      return 'cancelled';
    case 'SENT':
    case 'UNPAID':
    case 'PARTIALLY_PAID':
    case 'PAYMENT_PENDING':
    case 'SCHEDULED':
      return 'invoiced';
    default:
      return null;
  }
}

/**
 * Verify a webhook with PayPal: POST /v1/notifications/verify-webhook-signature.
 * The event must be passed through byte-for-byte, so the request body is assembled
 * around the raw payload instead of re-serializing parsed JSON.
 */
export async function verifyWebhookSignature(headers: Headers, rawBody: string): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error('PAYPAL_WEBHOOK_ID is not set');
  const required = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'];
  if (required.some((h) => !headers.get(h))) return false;
  try {
    JSON.parse(rawBody);
  } catch {
    return false;
  }
  const client = getToolkit().client;
  const meta = JSON.stringify({
    auth_algo: headers.get('paypal-auth-algo'),
    cert_url: headers.get('paypal-cert-url'),
    transmission_id: headers.get('paypal-transmission-id'),
    transmission_sig: headers.get('paypal-transmission-sig'),
    transmission_time: headers.get('paypal-transmission-time'),
    webhook_id: webhookId,
  });
  const body = `${meta.slice(0, -1)},"webhook_event":${rawBody}}`;
  const res = await fetch(`${client.getBaseUrl()}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await client.getAccessToken()}` },
    body,
  });
  if (!res.ok) return false;
  const json = (await res.json()) as { verification_status?: string };
  return json.verification_status === 'SUCCESS';
}

/** PayPal answers with a multipart body wrapping a base64 PNG; pull the image out. */
export function extractQrPng(result: unknown): string | null {
  const text = typeof result === 'string' ? result : JSON.stringify(result ?? '');
  const m = text.match(/iVBORw0KGgo[A-Za-z0-9+/=]+/);
  return m ? m[0] : null;
}
