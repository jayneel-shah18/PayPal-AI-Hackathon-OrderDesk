/**
 * Presentation helpers for the inbox. Display only: nothing here changes how
 * orders are parsed, priced or invoiced.
 */

export type Channel = 'text' | 'email' | 'photo';

/** Who each sample message is shown as coming from, and when it "arrived" this morning. */
export const SAMPLE_SENDERS: Record<string, { customer: string; channel: Channel; at: [hour: number, minute: number] }> = {
  clean: { customer: 'Main St Cafe', channel: 'text', at: [7, 52] },
  spanglish: { customer: "Rosa's Taqueria", channel: 'text', at: [7, 41] },
  ambiguous: { customer: 'Harborview Diner', channel: 'text', at: [7, 18] },
  out_of_stock: { customer: "Rosa's Taqueria", channel: 'text', at: [6, 55] },
  unknown_item: { customer: 'Harborview Diner', channel: 'text', at: [6, 37] },
  photo: { customer: 'Main St Cafe', channel: 'photo', at: [6, 20] },
  email_forward: { customer: 'Main St Cafe', channel: 'email', at: [6, 5] },
};

export const CHANNEL_LABEL: Record<Channel, string> = { text: 'Text message', email: 'Email', photo: 'Photo' };

export function channelOf(source: string, rawText: string): Channel {
  if (source === 'photo') return 'photo';
  return /^(from|subject|to):/im.test(rawText.slice(0, 200)) ? 'email' : 'text';
}

/** First meaningful line of a message, skipping email headers and greetings. */
export function previewOf(channel: Channel, rawText: string): string {
  if (channel === 'photo') return 'Photo of a handwritten order';
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('>'));
  const body = lines.filter((l) => !/^(from|to|subject|date|sent):/i.test(l) && !/^(hi|hello|hey|hola)[,!.]?$/i.test(l));
  return body[0] ?? lines[0] ?? '';
}

export function initials(name: string): string {
  const words = name.replace(/[^A-Za-z\s]/g, '').split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '')).toUpperCase();
}

const AVATAR_TONES = ['bg-[#e7d9c3] text-[#6b4a1e]', 'bg-[#d6e6dc] text-[#17694a]', 'bg-[#e3dcee] text-[#55407a]', 'bg-[#f3d9d0] text-[#8a3a22]', 'bg-[#d9e4ee] text-[#1f4f82]'];

export function avatarTone(name: string): string {
  let h = 0;
  [...name].forEach((c, i) => {
    h += c.charCodeAt(0) * (i + 1);
  });
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

/** Today at the given clock time, or yesterday if that has not happened yet. */
export function todayAt([hour, minute]: [number, number], now: Date): Date {
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  if (d > now) d.setDate(d.getDate() - 1);
  return d;
}

export function formatReceived(date: Date, now: Date): string {
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
