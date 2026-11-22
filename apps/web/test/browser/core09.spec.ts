import { expect, test, type Page } from '@playwright/test';

const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(async ({ page }) => { expect(pageErrors.get(page)).toEqual([]); });

// Isolated UI contract fixtures. No database, real credentials or production fallbacks.
async function fixture(page: Page) {
  const task = { id: 'fixture-task', number: 42, title: 'Тестовая закупка насоса' };
  const action = { id: 'fixture-action', version: 1, task, title: 'Проверить оплату', status: 'OVERDUE',
    assignee: { id: 'fixture-user', fullName: 'Тестовый Снабженец' }, dueAt: '2026-11-22T10:00:00Z',
    reminderAt: null, allowedOperations: ['UPDATE'] };
  const notices = [{ id: 'fixture-notice', task, type: 'ACTION_OVERDUE', title: 'Просрочена проверка оплаты', message: null, createdAt: '2026-11-22T09:00:00Z', readAt: null as string | null }];
  const state = { status: 0, missing: false, mutations: 0, conflict: false, role: 'ADMIN', noticeRequests: 0, delayRead: false };
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/me') return route.fulfill({ json: { id: 'fixture-user', role: state.role, fullName: 'Тестовый Снабженец', username: 'fixture' } });
    if (path.startsWith('/notifications') || path.startsWith('/next-actions')) {
      if (state.status) return route.fulfill({ status: state.status, json: { message: 'FOREIGN_PRIVATE_DATA' } });
      if (state.missing) return route.fulfill({ status: 404, json: {} });
    }
    if (path === '/notifications') {
      state.noticeRequests++;
      const filter = url.searchParams.get('filter');
      const items = notices.filter(item => filter === 'unread' ? !item.readAt : filter === 'read' ? Boolean(item.readAt) : true);
      return route.fulfill({ json: { items: [...items, ...items], unreadCount: notices.filter(item => !item.readAt).length, total: items.length, page: 1, pageSize: 20 } });
    }
    if (path.endsWith('/read')) {
      state.mutations++;
      if (state.delayRead) await new Promise(resolve => setTimeout(resolve, 100));
      notices[0].readAt = '2026-11-22T10:00:00Z'; return route.fulfill({ status: 204 });
    }
    if (path === '/next-actions') {
      expect(url.searchParams.get('scope')).toBe('mine'); expect(url.searchParams.get('sort')).toBe('dueAt');
      const filter = url.searchParams.get('filter');
      const title = filter === 'today' ? 'Запросить счёт' : filter === 'waiting_supplier' ? 'Ожидать поставщика' : action.title;
      const status = filter === 'today' ? 'TODAY' : filter === 'waiting_supplier' ? 'WAITING_SUPPLIER' : action.status;
      return route.fulfill({ json: { items: url.searchParams.get('q') ? [] : [{ ...action, title, status }], counts: { all: 3, today: 1, overdue: 1, waiting_supplier: 1 }, total: 1, page: 1, pageSize: 20, timeZone: 'Europe/Moscow' } });
    }
    if (path.startsWith('/next-actions/by-task/')) return route.fulfill({ json: { action, timeZone: 'Europe/Moscow' } });
    if (path.endsWith('/history')) return route.fulfill({ json: { items: [{ id: 'history-1', type: 'RESCHEDULED', actor: { fullName: 'Тестовый Снабженец' }, comment: 'Срок подтверждён поставщиком', createdAt: '2026-11-22T09:00:00Z' }] } });
    if (path === '/next-actions/fixture-action' && route.request().method() === 'PATCH') {
      state.mutations++;
      expect(route.request().headers()['if-match']).toBe(`"${action.version}"`);
      expect(route.request().headers()['idempotency-key']).toBeTruthy();
      await new Promise(resolve => setTimeout(resolve, 100));
      action.version++;
      if (state.conflict) return route.fulfill({ status: 409, json: {} });
      Object.assign(action, route.request().postDataJSON()); return route.fulfill({ json: action });
    }
    if (path === '/tasks') return route.fulfill({ json: [{ ...task, nextAction: 'Действие старого API', reminderAt: null }] });
    if (path === '/tasks/fixture-task') return route.fulfill({ json: { ...task, nextAction: 'Действие старого API', reminderAt: null, deadline: null, priority: 'NORMAL', status: 'NEW', description: null, createdAt: '2026-11-22T09:00:00Z', updatedAt: '2026-11-22T09:00:00Z', closedAt: null, selectedOfferId: null, selectedOffer: null, activities: [], items: [], supplierOffers: [], purchaseOrder: null, purchaseOrders: [] } });
    throw new Error(`Unexpected test request: ${path}`);
  });
  return { state, action };
}

test('server filters, counters, search, deep link and responsive layout', async ({ page }) => {
  await fixture(page); await page.goto('/actions');
  await expect(page.getByRole('heading', { name: 'Проверить оплату', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Все активные 3', exact: true })).toBeVisible();
  for (const [label, filter, title] of [['Сегодня', 'today', 'Запросить счёт'], ['Просрочено', 'overdue', 'Проверить оплату'], ['Ожидаем поставщика', 'waiting_supplier', 'Ожидать поставщика']]) {
    await page.getByRole('button', { name: new RegExp('^' + label) }).click();
    await expect(page).toHaveURL(new RegExp('filter=' + filter));
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole('textbox', { name: 'Поиск по закупке' }).fill('Нет такой закупки');
  await page.getByRole('button', { name: 'Найти', exact: true }).click();
  await expect(page.getByText('По выбранным условиям действий нет.')).toBeVisible();
});

test('notification deduplication, unread count, persistent read and keyboard focus', async ({ page }) => {
  const { state } = await fixture(page); state.delayRead = true;
  await page.goto('/notifications');
  await expect(page.getByRole('link', { name: 'Просрочена проверка оплаты', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Уведомления, непрочитанных: 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Отметить прочитанным', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Уведомления, непрочитанных: 0', exact: true })).toBeVisible();
  expect(state.mutations).toBe(1);
  await page.getByRole('button', { name: 'Непрочитанные', exact: true }).click();
  await expect(page.getByText('Новых уведомлений нет')).toBeVisible();
  const bell = page.getByRole('button', { name: /^Уведомления,/ });
  await bell.click(); await expect(page.getByRole('region', { name: 'Панель уведомлений' })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(bell).toBeFocused();
});

test('polling uses one shared feed and does not duplicate events', async ({ page }) => {
  const { state } = await fixture(page); await page.clock.install(); await page.goto('/notifications');
  await expect(page.getByRole('link', { name: 'Просрочена проверка оплаты', exact: true })).toBeVisible();
  const before = state.noticeRequests; await page.clock.fastForward(61000);
  await expect.poll(() => state.noticeRequests).toBe(before + 1);
  await expect(page.getByRole('link', { name: 'Просрочена проверка оплаты', exact: true })).toHaveCount(1);
});

test('late canceled filter response cannot replace current results', async ({ page }) => {
  await fixture(page);
  let release: (() => void) | undefined;
  await page.route('**/api/v1/next-actions?**', async route => {
    if (new URL(route.request().url()).searchParams.get('filter') !== 'today') return route.fallback();
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: { items: [], counts: { all: 0, today: 0, overdue: 0, waiting_supplier: 0 }, total: 0, page: 1, pageSize: 20, timeZone: 'UTC' } }).catch(() => {});
  });
  await page.goto('/actions'); await expect(page.getByRole('heading', { name: 'Проверить оплату', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Сегодня/ }).click(); await expect.poll(() => Boolean(release)).toBe(true);
  await page.getByRole('button', { name: /^Просрочено/ }).click();
  await expect(page.getByRole('heading', { name: 'Проверить оплату', exact: true })).toBeVisible(); release!();
  await expect(page.getByRole('button', { name: 'Все активные 3', exact: true })).toBeVisible();
});

test('EMPLOYEE never mounts feeds or protected action content', async ({ page }) => {
  const { state } = await fixture(page); state.role = 'EMPLOYEE'; await page.goto('/actions');
  await expect(page.getByText('Недостаточно прав', { exact: true })).toBeVisible();
  expect(state.noticeRequests).toBe(0); await expect(page.locator('article')).toHaveCount(0);
});

test('history, editor, double submit prevention and refresh', async ({ page }) => {
  const { state } = await fixture(page); await page.goto('/tasks/fixture-task');
  await page.getByRole('button', { name: 'История действия', exact: true }).click();
  await expect(page.getByText('Срок подтверждён поставщиком')).toBeVisible();
  await page.getByRole('button', { name: 'Изменить действие', exact: true }).click();
  await page.getByLabel('Следующее действие', { exact: true }).fill('Получить подтверждение оплаты');
  await page.getByRole('button', { name: 'Сохранить действие', exact: true }).evaluate(button => {
    const form = (button as HTMLButtonElement).form!; form.requestSubmit(); form.requestSubmit();
  });
  await expect(page.getByText('Действие сохранено.')).toBeVisible(); expect(state.mutations).toBe(1);
  await expect(page.getByRole('heading', { name: 'Получить подтверждение оплаты', exact: true })).toBeVisible();
});

test('409 conflict closes stale editor; absent permission hides mutation controls', async ({ page }) => {
  const { state, action } = await fixture(page); state.conflict = true;
  await page.goto('/tasks/fixture-task'); await page.getByRole('button', { name: 'Изменить действие', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить действие', exact: true }).click();
  await expect(page.getByText(/Действие изменено другим пользователем/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сохранить действие', exact: true })).toHaveCount(0);
  action.allowedOperations = []; await page.reload();
  await expect(page.getByRole('heading', { name: 'Проверить оплату', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Изменить действие', exact: true })).toHaveCount(0);
});

test('missing API shows actual legacy data, with unknown counters and unavailable filters', async ({ page }) => {
  const { state } = await fixture(page); state.missing = true; await page.goto('/actions');
  await expect(page.getByText('Действие старого API', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Сегодня/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Уведомления, счётчик недоступен', exact: true })).toBeVisible();
});

test('500 error and retry never expose a server body', async ({ page }) => {
  const { state } = await fixture(page); state.status = 500; await page.goto('/actions');
  await expect(page.getByText('Не удалось получить данные. Повторите попытку.')).toBeVisible();
  await expect(page.getByText('FOREIGN_PRIVATE_DATA')).toHaveCount(0);
  state.status = 0; await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Проверить оплату', exact: true })).toBeVisible();
});

for (const status of [401, 403]) test(`${status} hides protected content and resets AuthGate`, async ({ page }) => {
  const { state } = await fixture(page); state.status = status; await page.goto('/actions');
  await expect(page.getByText(status === 401 ? 'Вход в Supply Manager' : 'Недостаточно прав', { exact: true })).toBeVisible();
  await expect(page.locator('article')).toHaveCount(0); await expect(page.getByText('FOREIGN_PRIVATE_DATA')).toHaveCount(0);
});
