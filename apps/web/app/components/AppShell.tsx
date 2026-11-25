'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { useSession } from './AuthGate';
import { Dialog } from './Dialog';
import GlobalSearch from './GlobalSearch';
import { getCurrentSection, navigation, roleLabels } from './navigation';
import PageLayout from './PageLayout';
import { Alert, Avatar, Button, EmptyState, Input } from './ui';

const collapseKey = 'supply-manager:sidebar-collapsed';
const sidebarChange = 'supply-manager:sidebar-change';

function subscribeSidebar(callback: () => void) {
  window.addEventListener(sidebarChange, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(sidebarChange, callback);
    window.removeEventListener('storage', callback);
  };
}

function readCollapsed() {
  try { return localStorage.getItem(collapseKey) === 'true'; }
  catch { return false; }
}

const icons = {
  home: 'M3 10l9-7 9 7v10h-6v-6H9v6H3z',
  purchases: 'M3 4h2l3 11h11l2-8H6m3 13h.01m9 0h.01',
  requests: 'M6 3h8l4 4v14H6zm3 9h6m-6 4h6M14 3v5h4',
  registry: 'M3 7l9-4 9 4-9 4zm0 5 9 4 9-4M3 17l9 4 9-4',
  suppliers: 'M3 21V7l9-4 9 4v14H3zm5 0v-8h8v8',
  analytics: 'M4 4v16h16M8 16v-4m5 4V8m5 8V5',
  plus: 'M12 5v14M5 12h14',
  menu: 'M4 6h16M4 12h16M4 18h16',
  panel: 'M3 4h18v16H3zm6 0v16',
  search: 'M21 21l-5-5m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
  chevron: 'm6 9 6 6 6-6',
};

function Icon({ name }: { name: keyof typeof icons }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d={icons[name]} /></svg>;
}

function Brand() {
  return <Link href="/dashboard" className="app-brand">
    <span className="brand-mark" aria-hidden="true">SM</span>
    <span className="brand-text"><strong>Supply Manager</strong><small>Снабжение и закупки</small></span>
  </Link>;
}

type Entries = typeof navigation;
type Current = ReturnType<typeof getCurrentSection>;

function NavLinks({ entries, current, pathname, onNavigate }: {
  entries: Entries;
  current: Current;
  pathname: string;
  onNavigate?: () => void;
}) {
  return <nav className="app-nav" aria-label="Основная навигация">
    {entries.map((entry) => <Link className="app-nav-link" href={entry.href} key={entry.href} onClick={onNavigate}
      aria-label={entry.label} title={entry.label} aria-current={current === entry ? (entry.href === pathname ? 'page' : 'location') : undefined}>
      <Icon name={entry.icon} /><span>{entry.label}</span>
    </Link>)}
  </nav>;
}

function Breadcrumbs({ current, pathname, canSeeSection }: { current: Current; pathname: string; canSeeSection: boolean }) {
  if (!current || current.href === '/dashboard') return <span className="text-sm font-semibold">Главная</span>;
  const details = pathname.startsWith('/tasks/') ? 'Карточка закупки' :
    pathname.startsWith('/requests/') ? 'Карточка заявки' :
    pathname === '/suppliers/manage' ? 'Справочник поставщиков' :
    pathname.startsWith('/suppliers/') ? 'Карточка поставщика' : undefined;
  return <nav aria-label="Хлебные крошки" className="app-crumbs">
    <Link href="/dashboard">Главная</Link><span aria-hidden="true">›</span>
    {details && canSeeSection ? <Link href={current.href}>{current.label}</Link> :
      <span aria-current={details ? undefined : 'page'}>{current.label}</span>}
    {details && <><span aria-hidden="true">›</span><span aria-current="page">{details}</span></>}
  </nav>;
}

function SectionSearch({ entries }: { entries: Entries }) {
  const [query, setQuery] = useState('');
  const matches = entries.filter(({ label }) => label.toLowerCase().includes(query.trim().toLowerCase()));
  return <Dialog title="Поиск по разделам" trigger={(open) =>
    <Button variant="outline" className="app-search" onClick={() => { setQuery(''); open(); }} aria-label="Поиск по разделам" aria-haspopup="dialog">
      <Icon name="search" /><span>Поиск по разделам</span>
    </Button>}>
    {(close) => <>
      <Input type="search" aria-label="Название раздела" placeholder="Название раздела" value={query}
        onChange={(event) => setQuery(event.target.value)} data-initial-focus />
      {matches.length ? <NavLinks entries={matches} current={undefined} pathname="" onNavigate={close} /> :
        <p role="status" className="mt-4 text-sm text-muted">Разделы не найдены.</p>}
    </>}
  </Dialog>;
}

function UserMenu() {
  const { user, signingOut, logoutError, logout } = useSession();
  return <div className="relative">
    <Button variant="ghost" className="app-user-button" popoverTarget="app-user-menu">
      <Avatar name={user.fullName} />
      <span className="app-user-label"><strong>{user.fullName}</strong><small>{roleLabels[user.role]}</small></span>
      <span className="sr-only">Меню пользователя</span>
      <Icon name="chevron" />
    </Button>
    <div popover="auto" id="app-user-menu" className="ui-popover" aria-label="Меню пользователя">
      <div className="user-details"><strong>{user.fullName}</strong><small>{roleLabels[user.role]}</small></div>
      <hr className="ui-divider" />
      {logoutError && <Alert tone="danger">{logoutError}</Alert>}
      <Link href="/settings/telegram" className="ui-button ui-button--ghost w-full justify-start">Настройки Telegram</Link>
      <Button variant="ghost" className="w-full justify-start" loading={signingOut} onClick={() => void logout()}>Выйти</Button>
    </div>
  </div>;
}

function WorkspaceContent({ children, allowed }: { children: ReactNode; allowed: boolean }) {
  if (allowed) return children;

  return <PageLayout title="Недостаточно прав">
    <EmptyState title="403 · Доступ ограничен" description="Для этого раздела требуются дополнительные права."
      action={<Link href="/dashboard" className="ui-button ui-button--outline">На главную</Link>} />
  </PageLayout>;
}

export default function AppShell({ children, tools }: { children: ReactNode; tools?: ReactNode }) {
  const pathname = usePathname();
  const { user } = useSession();
  const [fallbackCollapsed, setFallbackCollapsed] = useState(false);
  const stored = useSyncExternalStore(subscribeSidebar, readCollapsed, () => false);
  const collapsed = stored || fallbackCollapsed;
  const current = getCurrentSection(pathname, user.role);
  const entries = navigation.filter((entry) => entry.roles.includes(user.role));
  const allowed = !current || entries.includes(current);

  function toggleSidebar() {
    try {
      localStorage.setItem(collapseKey, String(!collapsed));
      window.dispatchEvent(new Event(sidebarChange));
    } catch {
      setFallbackCollapsed(!collapsed);
    }
  }

  return <div className="app-shell" data-collapsed={collapsed}>
    <a href="#workspace-main" className="skip-link">К содержимому</a>
    <aside className="app-sidebar" aria-label="Боковая панель">
      <Brand />
      <NavLinks entries={entries} current={current} pathname={pathname} />
    </aside>
    <div className="app-body">
      <header className="app-header">
        <div className="app-header-context">
          <Button variant="ghost" icon className="app-sidebar-toggle" aria-pressed={collapsed}
            aria-label={collapsed ? 'Развернуть боковое меню' : 'Свернуть боковое меню'} onClick={toggleSidebar}>
            <Icon name="panel" />
          </Button>
          <Dialog key={pathname} title="Навигация" className="app-drawer"
            trigger={(open) => <Button variant="ghost" icon className="app-mobile-toggle" aria-label="Открыть навигацию" aria-haspopup="dialog" onClick={open}>
              <Icon name="menu" />
            </Button>}>
            {(close) => <NavLinks entries={entries} current={current} pathname={pathname} onNavigate={close} />}
          </Dialog>
          <Breadcrumbs current={current} pathname={pathname} canSeeSection={allowed} />
        </div>
        <div className="app-header-search">
          <GlobalSearch key={pathname} />
        </div>
        <div className="app-header-tools" key={pathname}>
          <SectionSearch entries={entries} />
          {tools}
          <UserMenu />
        </div>
      </header>
      <main id="workspace-main" className="app-main" tabIndex={-1}>
        <WorkspaceContent key={pathname} allowed={allowed}>{children}</WorkspaceContent>
      </main>
    </div>
  </div>;
}
