'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useCurrentUser } from './AuthGate';
import GlobalSearch from './GlobalSearch';

type AppShellProps = {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  action?: ReactNode;
};

type IconType = 'requests' | 'tasks' | 'registry' | 'suppliers';

function BoxIcon({ type }: { type: IconType }) {
  const common = 'h-5 w-5';

  if (type === 'requests') {
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
        <path d="M8 9h8M8 13h8M8 17h5" />
        <circle cx="18.5" cy="5.5" r="2.5" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  if (type === 'tasks') {
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
        <path d="M8 9h8M8 13h8M8 17h5" />
      </svg>
    );
  }

  if (type === 'registry') {
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 7h16M4 12h16M4 17h16" />
        <path d="M7 4v16M17 4v16" opacity=".45" />
      </svg>
    );
  }

  return (
    <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M16 20v-1.5A3.5 3.5 0 0 0 12.5 15h-5A3.5 3.5 0 0 0 4 18.5V20" />
      <circle cx="10" cy="8" r="3" />
      <path d="M17 8h3M18.5 6.5v3" />
    </svg>
  );
}

function isCurrentPath(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppShell({
  children,
  title,
  subtitle,
  action,
}: AppShellProps) {
  const pathname = usePathname();
  const employee = useCurrentUser()?.role === 'EMPLOYEE';
  const links: { href: string; label: string; mobile: string; icon: IconType }[] = [
    { href: '/requests', label: employee ? 'Мои заявки' : 'Входящие заявки', mobile: 'Заявки', icon: 'requests' },
    ...(employee ? [] : [
      { href: '/', label: 'Закупки', mobile: 'Закупки', icon: 'tasks' as const },
      { href: '/registry', label: 'Реестр позиций', mobile: 'Реестр', icon: 'registry' as const },
      { href: '/suppliers', label: 'Поставщики', mobile: 'Поставщики', icon: 'suppliers' as const },
      { href: '/orders', label: 'Заказы', mobile: 'Заказы', icon: 'tasks' as const },
      { href: '/analytics', label: 'Аналитика', mobile: 'Аналитика', icon: 'registry' as const },
    ]),
  ];

  const desktopLinkClass = (href: string) =>
    `flex items-center gap-3 rounded-xl px-3.5 py-3 font-medium transition ${
      isCurrentPath(pathname, href)
        ? 'bg-blue-50 text-blue-700'
        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
    }`;

  const mobileLinkClass = (href: string) =>
    `flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium transition ${
      isCurrentPath(pathname, href)
        ? 'text-blue-600'
        : 'text-slate-500'
    }`;

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-950">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] border-r border-slate-200/80 bg-white lg:flex lg:flex-col">
        <div className="flex h-20 items-center gap-3 border-b border-slate-100 px-5">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-blue-600 text-sm font-bold text-white shadow-sm shadow-blue-200">
            SM
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">Supply Manager</div>
            <div className="text-xs text-slate-400">Снабжение и закупки</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1.5 px-3 py-5 text-sm">
          {links.map(({ href, label, icon }) => (
            <Link key={href} href={href} className={desktopLinkClass(href)}
              aria-current={isCurrentPath(pathname, href) ? 'page' : undefined}>
              <BoxIcon type={icon} />{label}
            </Link>
          ))}
        </nav>

      </aside>

      <div className="lg:pl-[232px]">
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur">
          <div className="mx-auto flex min-h-20 max-w-[1500px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2 lg:hidden">
                <div className="grid h-8 w-8 place-items-center rounded-xl bg-blue-600 text-[10px] font-bold text-white">
                  SM
                </div>
                <span className="text-xs font-semibold text-slate-500">
                  Supply Manager
                </span>
              </div>

              {title && (
                <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
                  {title}
                </h1>
              )}

              {subtitle && (
                <p className="mt-1 hidden text-sm text-slate-500 sm:block">
                  {subtitle}
                </p>
              )}
            </div>

            {action && <div className="shrink-0">{action}</div>}
          </div>
          <div className="mx-auto max-w-[1500px] px-4 pb-3 sm:px-6 lg:px-8">
            <GlobalSearch />
          </div>
        </header>

        <main className="mx-auto max-w-[1500px] px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-10">
          {children}
        </main>
      </div>

      <nav aria-label="Разделы" className="fixed inset-x-0 bottom-0 z-40 flex justify-between overflow-x-auto border-t border-slate-200 bg-white/95 px-1 py-2 backdrop-blur lg:hidden">
        {links.map(({ href, mobile, icon }) => (
          <Link key={href} href={href} className={mobileLinkClass(href)}
            aria-current={isCurrentPath(pathname, href) ? 'page' : undefined}>
            <BoxIcon type={icon} />{mobile}
          </Link>
        ))}
      </nav>
    </div>
  );
}
