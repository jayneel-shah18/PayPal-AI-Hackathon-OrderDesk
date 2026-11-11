/** Small fetch helper for client components: JSON in, JSON out, errors as exceptions. */
export async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

export type Meta = {
  samples: { id: string; label: string; tests: string; text: string; image?: string }[];
  customers: { id: string; name: string; email: string }[];
  catalog: { sku: string; name: string; unit: string; packSize: number; priceCents: number; stock: number }[];
  config: { model: string; claude: boolean; paypal: boolean; webhook: boolean };
};
