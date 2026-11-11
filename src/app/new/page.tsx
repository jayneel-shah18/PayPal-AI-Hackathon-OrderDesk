'use client';

import Link from 'next/link';
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
    <div className="mx-auto max-w-2xl">
      <Link href="/" className="text-sm text-muted hover:text-ink">
        ← Inbox
      </Link>
      <h1 className="mt-2 font-display text-3xl font-semibold">New order</h1>
      <p className="mt-1 text-sm text-muted">
        Took an order by phone or on paper? Paste the message as it came in, or attach a photo of the note. Nothing is sent to the customer until you approve it.
      </p>

      {missing.length > 0 && (
        <p className="mt-4 rounded-lg border border-amber-rule bg-amber-soft px-3 py-2 text-sm text-amber-ink">
          Setup is not finished: {missing.join(' and ')} not set on the server.
        </p>
      )}

      <div className="card mt-5 p-3 sm:p-4">
        <textarea
          className="block h-48 w-full resize-y rounded-lg border border-rule bg-white p-3 text-[15px] leading-relaxed focus:outline-2 focus:outline-leaf"
          placeholder={'Need 2 cases of 12 oz hot cups and 5 boxes of coffee filters…'}
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
        </div>
        {error && <p className="mt-3 text-sm text-brick">{error}</p>}
      </div>
    </div>
  );
}
