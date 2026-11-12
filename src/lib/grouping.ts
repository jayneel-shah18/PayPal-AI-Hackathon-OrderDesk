import type { OrderStatus } from './schema';

export type GroupBy = 'status' | 'customer';
export type StatusFilter = 'all' | 'draft' | 'needs_info' | 'invoiced' | 'paid';

export type Groupable = { status: OrderStatus; recipientName: string | null; customerHint: string | null; totalCents: number; createdAt: string | Date };
export type OrderGroup<T> = { key: string; title: string; hint: string; dot: string; rows: T[]; totalCents: number };

export const STATUS_GROUPS: { key: Exclude<StatusFilter, 'all'>; title: string; hint: string; dot: string; tone: string }[] = [
  { key: 'draft', title: 'Draft', hint: 'Ready for you to approve', dot: 'bg-ink', tone: 'text-ink' },
  { key: 'needs_info', title: 'Needs info', hint: 'Waiting on an answer', dot: 'bg-amber-rule', tone: 'text-amber-ink' },
  { key: 'invoiced', title: 'Invoiced', hint: 'Sent, awaiting payment', dot: 'bg-sky-ink', tone: 'text-sky-ink' },
  { key: 'paid', title: 'Paid', hint: 'Money in', dot: 'bg-leaf', tone: 'text-leaf' },
];
const OTHER = { key: 'other', title: 'Other', hint: 'In progress, failed or cancelled', dot: 'bg-muted' };

export const customerOf = (r: Pick<Groupable, 'recipientName' | 'customerHint'>) => r.recipientName ?? r.customerHint ?? 'Unknown customer';
export const sumCents = (rows: { totalCents: number }[]) => rows.reduce((s, r) => s + r.totalCents, 0);

/** Filter orders by status, then group them by status or by customer, newest first within a group. */
export function groupOrders<T extends Groupable>(rows: T[], by: GroupBy, filter: StatusFilter = 'all'): OrderGroup<T>[] {
  const kept = (filter === 'all' ? rows : rows.filter((r) => r.status === filter)).slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const make = (g: { key: string; title: string; hint: string; dot: string }, list: T[]): OrderGroup<T> => ({ ...g, rows: list, totalCents: sumCents(list) });

  if (by === 'customer') {
    const names = [...new Set(kept.map(customerOf))].sort((a, b) => a.localeCompare(b));
    return names.map((name) => {
      const list = kept.filter((r) => customerOf(r) === name);
      return make({ key: `customer:${name}`, title: name, hint: '', dot: 'bg-leaf' }, list);
    });
  }

  const known = new Set<string>(STATUS_GROUPS.map((g) => g.key));
  const groups = STATUS_GROUPS.filter((g) => filter === 'all' || g.key === filter).map((g) =>
    make(
      g,
      kept.filter((r) => r.status === g.key),
    ),
  );
  const rest = kept.filter((r) => !known.has(r.status));
  if (rest.length) groups.push(make(OTHER, rest));
  return groups;
}
