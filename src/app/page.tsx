'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, type Meta } from '@/lib/client';

export default function NewOrderPage() {
  const router = useRouter();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [text, setText] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<Meta>('/api/meta').then(setMeta).catch((e) => setError(e.message));
  }, []);

  function readFile(file: File | Blob) {
    const reader = new FileReader();
    reader.onload = () => setImage(String(reader.result));
    reader.readAsDataURL(file);
  }

  async function pickSample(s: Meta['samples'][number]) {
    setError(null);
    setText(s.text);
    setImage(null);
    if (s.image) {
      const res = await fetch(s.image);
      if (res.ok) readFile(await res.blob());
      else setError('Sample photo is missing.');
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { id } = await api<{ id: string }>('/api/parse', { method: 'POST', body: { text, image } });
      router.push(`/orders/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const missing = meta ? [!meta.config.claude && 'ANTHROPIC_API_KEY', !meta.config.paypal && 'PayPal sandbox credentials'].filter(Boolean) : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <section>
        <h1 className="font-display text-3xl font-semibold">New order</h1>
        <p className="mt-1 text-sm text-muted">
          Paste the message exactly as it arrived: text, email, half Spanish, no SKUs. Nothing goes to PayPal until you approve it.
        </p>

        {missing.length > 0 && (
          <p className="mt-4 rounded-lg border border-amber-rule bg-amber-soft px-3 py-2 text-sm text-amber-ink">
            Server setup incomplete: {missing.join(' and ')} not set. See the README.
          </p>
        )}

        <div className="mt-4 rounded-xl border border-rule bg-card p-3 shadow-sm">
          <textarea
            className="block h-52 w-full resize-y rounded-lg border border-rule bg-white p-3 text-[15px] leading-relaxed focus:outline-2 focus:outline-leaf"
            placeholder={'Hola! Necesito 10 paquetes de servilletas y 4 jugs of dish soap para mañana…'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Order message"
          />
          {image && (
            <div className="mt-3 flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt="Attached order photo" className="h-28 rounded-lg border border-rule object-cover" />
              <button className="btn" onClick={() => setImage(null)}>
                Remove photo
              </button>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button className="btn btn-primary" disabled={busy || (!text.trim() && !image)} onClick={submit}>
              {busy ? 'Starting…' : 'Read order'}
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              Attach photo
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) readFile(f);
                e.target.value = '';
              }}
            />
            {error && <span className="text-sm text-brick">{error}</span>}
          </div>
        </div>
      </section>

      <aside>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Try a sample</h2>
        <ul className="mt-2 space-y-2">
          {(meta?.samples ?? []).map((s) => (
            <li key={s.id}>
              <button
                onClick={() => pickSample(s)}
                className="w-full rounded-lg border border-rule bg-card px-3 py-2 text-left transition hover:border-ink"
              >
                <span className="block text-sm font-medium">{s.label}</span>
                <span className="block text-xs text-muted">{s.tests}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
