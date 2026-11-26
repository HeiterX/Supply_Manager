import type { ReactNode } from 'react';
import AuthGate, { useSession } from '../components/AuthGate';
import AppShell from '../components/AppShell';
import { NotificationProvider } from '../components/core09/NotificationCenter';

function AuthorizedWorkspace({ children }: { children: ReactNode }) {
  const { user } = useSession();
  if (user.role === 'EMPLOYEE') return <AppShell>{children}</AppShell>;
  return <NotificationProvider><AppShell>{children}</AppShell></NotificationProvider>;
}
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <AuthGate allowEmployee><AuthorizedWorkspace>{children}</AuthorizedWorkspace></AuthGate>;
}
