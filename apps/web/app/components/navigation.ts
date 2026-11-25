import type { UserRole } from '@/lib/auth';

export const roleLabels: Record<UserRole, string> = {
  ADMIN: 'Администратор',
  PROCUREMENT: 'Снабженец',
  EMPLOYEE: 'Сотрудник',
};

const procurement = ['ADMIN', 'PROCUREMENT'] as const;
const everyone = [...procurement, 'EMPLOYEE'] as const;

type NavigationEntry = {
  href: string;
  label: string;
  icon: 'home' | 'purchases' | 'requests' | 'registry' | 'suppliers' | 'analytics' | 'plus';
  roles: readonly UserRole[];
};

export const navigation: readonly NavigationEntry[] = [
  { href: '/dashboard', label: 'Главная', icon: 'home', roles: everyone },
  { href: '/', label: 'Закупки', icon: 'purchases', roles: procurement },
  { href: '/requests', label: 'Входящие заявки', icon: 'requests', roles: procurement },
  { href: '/registry', label: 'Реестр позиций', icon: 'registry', roles: procurement },
  { href: '/suppliers', label: 'Поставщики', icon: 'suppliers', roles: procurement },
  { href: '/orders', label: 'Заказы', icon: 'purchases', roles: procurement },
  { href: '/analytics', label: 'Аналитика', icon: 'analytics', roles: procurement },
  { href: '/my-requests', label: 'Мои заявки', icon: 'requests', roles: ['EMPLOYEE'] },
  { href: '/request', label: 'Подать заявку', icon: 'plus', roles: everyone },
];

export function getCurrentSection(pathname: string, role: UserRole) {
  if (role === 'EMPLOYEE' && (pathname === '/requests' || pathname.startsWith('/requests/'))) {
    return navigation.find(({ href }) => href === '/my-requests');
  }
  if (pathname.startsWith('/tasks/')) return navigation.find(({ href }) => href === '/');
  return navigation.find(({ href }) => pathname === href || (href !== '/' && pathname.startsWith(href + '/')));
}
