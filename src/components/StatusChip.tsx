import { type OrderStatus, STATUS_LABEL } from '@/lib/schema';

const STYLE: Record<OrderStatus, string> = {
  parsing: 'bg-sky-soft text-sky-ink',
  sending: 'bg-sky-soft text-sky-ink',
  draft: 'bg-paper text-ink border border-rule',
  needs_info: 'bg-amber-soft text-amber-ink',
  invoiced: 'bg-sky-soft text-sky-ink',
  paid: 'bg-leaf-soft text-leaf',
  cancelled: 'bg-paper text-muted border border-rule line-through',
  failed: 'bg-brick-soft text-brick',
};

export function StatusChip({ status }: { status: OrderStatus }) {
  const live = status === 'parsing' || status === 'sending';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STYLE[status] ?? STYLE.draft}`}>
      {live && <span className="live-dot h-1.5 w-1.5 rounded-full bg-current" />}
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
