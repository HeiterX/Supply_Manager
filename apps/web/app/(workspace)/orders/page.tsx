import { Suspense } from 'react';
import PageLayout from '@/app/components/PageLayout';
import OrderDirectory from '@/app/components/OrderDirectory';

export default function OrdersPage() {
  return (
    <PageLayout title="Заказы"><Suspense><OrderDirectory /></Suspense></PageLayout>
  );
}
