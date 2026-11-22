import type { ReactNode } from 'react';
import AuthGate from '../components/AuthGate';
import AppShell from '../components/AppShell';

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <AuthGate><AppShell>{children}</AppShell></AuthGate>;
}
