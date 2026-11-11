import { OrderReview } from '@/components/OrderReview';

export const dynamic = 'force-dynamic';

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  return <OrderReview id={(await params).id} />;
}
