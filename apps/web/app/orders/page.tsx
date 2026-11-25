import { Suspense } from 'react';
import AppShell from '../components/AppShell';
import AuthGate from '../components/AuthGate';
import OrderDirectory from '../components/OrderDirectory';

export default function OrdersPage() {
  return (
    <AuthGate>
      <AppShell title="Заказы"><Suspense><OrderDirectory /></Suspense></AppShell>
    </AuthGate>
  );
}
