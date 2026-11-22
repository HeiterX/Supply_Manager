import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import AxeBuilder from '@axe-core/playwright';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CORE13_PLAYWRIGHT || 'playwright');
const web = new URL(process.env.CORE13_WEB || 'http://127.0.0.1:3391');
if (!['127.0.0.1', 'localhost'].includes(web.hostname)) throw new Error('Use a local production build.');
const fixtureImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5b8AAAAASUVORK5CYII=', 'base64');
const date = '2026-11-20T12:00:00.000Z';
const user = { id: 'staff-1', username: 'fixture', fullName: 'Тестовый снабженец', role: 'PROCUREMENT' };
const part = { id: 'part-1', name: 'Комплект уплотнений для стенда', quantity: '4.5', unit: 'компл.', partNumber: 'QA-10', unitPrice: '1200', currency: 'RUB', notes: 'Синтетическая позиция' };
const supplier = { id: 'supplier-1', name: 'Тестовая верфь' };
const offer = { id: 'offer-1', status: 'RECEIVED', price: '5400', deliveryPrice: '100', deliveryDays: 5, requestedAt: date, supplier,
  items: [{ id: 'line-1', taskItemId: part.id, taskItem: part, quantity: '4.5', unitPrice: '1200', currency: 'RUB', inStock: true }] };
const task = { id: 'fixture-task', number: 314, title: 'Уплотнения испытательного стенда', status: 'SEARCHING', priority: 'HIGH',
  createdAt: date, updatedAt: date, deadline: date, nextAction: 'Уточнить наличие', reminderAt: null, items: [part], supplierOffers: [offer],
  activities: [{ id: 'event-1', text: 'Закупка создана', createdAt: date }], purchaseOrders: [], purchaseOrder: null };
const order = { id: 'order-1', supplierOfferId: offer.id, supplier, status: 'RECEIVED', invoiceNumber: 'QA-314', invoiceDate: date, totalPrice: '2500',
  paidAt: date, sentToPaymentAt: date, shippedAt: date, receivedAt: date, expectedDeliveryAt: date, carrier: 'Тестовая доставка', trackingNumber: 'QA-TRACK',
  items: [{ ...part, taskItemId: part.id, quantity: '2' }] };
const request = { id: 'fixture-request', number: 91, title: 'Комплект к испытаниям', requesterName: 'Тестовый заявитель', status: 'NEW',
  priority: 'NORMAL', createdAt: date, description: 'Проверка стенда', items: [{ ...part, photoPath: 'protected', photoOriginalName: 'test-part.png' }] };
const pageOf = (items, page, pageSize, total = 30) =>
  ({ items, page, pageSize, total, hasPrevious: page > 1, hasNext: page * pageSize < total });

async function setup(browser, role = 'PROCUREMENT') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(6500);
  const failures = [];
  const calls = { list: [], orders: [], public: [], uploads: [], registrations: [], accepts: 0, photos: 0, photoStatus: 403,
    listStatus: 200, requestStatus: 200, taskStatus: 200, nextActionStatus: 200, deletions: 0 };
  page.on('pageerror', (error) => failures.push(error.message));
  let orders = [];
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.slice('/api/v1'.length);
    const method = route.request().method();
    const headers = { 'access-control-allow-origin': web.origin, 'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': 'content-type,x-upload-token',
      'access-control-expose-headers': 'Retry-After' };
    const respond = (json, status = 200) => route.fulfill({ json, status,
      headers: status === 429 ? { ...headers, 'retry-after': '2' } : headers });
    if (method === 'OPTIONS') return route.fulfill({ headers, status: 204 });
    if (path === '/auth/me') return respond({ ...user, role });
    if (path === '/auth/register') {
      calls.registrations.push(route.request().postDataJSON());
      return calls.registrations.length === 1 ? respond({ message: ['email must be an email'] }, 422) : respond({}, 201);
    }
    if (path.startsWith('/discovery/lists/')) {
      calls.list.push(url.searchParams);
      if (url.searchParams.get('q') === 'завершённая сессия') return respond({}, 401);
      if (calls.listStatus !== 200) return respond({ message: 'Prisma: SQLSTATE QA-internal' }, calls.listStatus);
      const number = Number(url.searchParams.get('page') || 1);
      const size = Number(url.searchParams.get('pageSize') || 25);
      if (path.endsWith('/tasks')) return respond(pageOf([{ ...task, title: number === 1 ? task.title : 'Закупка на второй странице' }], number, size));
      if (path.endsWith('/items')) {
        const count = url.searchParams.get('q') === 'отсутствующая позиция' ? 0 : size === 100 ? 100 : 1;
        return respond(pageOf(Array.from({ length: count }, (_, index) => ({
          ...part, id: `registry-${index}`, name: index ? `Позиция ${index + 1}` : 'Позиция' + 'Стенд'.repeat(90), task,
        })), number, size, count));
      }
      return respond(pageOf([request], number, size, 1));
    }
    if (path === '/tasks') return respond([task]);
    if (path === '/purchase-requests') return respond([request]);
    if (path === '/purchase-requests/mine') return respond([request]);
    if (path === `/tasks/${task.id}`) return respond({ ...task, purchaseOrders: orders }, calls.taskStatus);
    if (path === `/tasks/${task.id}/items/${part.id}` && method === 'DELETE') {
      calls.deletions += 1;
      return respond({});
    }
    if (path === `/next-actions/by-task/${task.id}`) return respond({ action: { task: { id: task.id }, title: 'Уточнить срок тестовой поставки',
      assignee: user, dueAt: date, status: 'OVERDUE' } }, calls.nextActionStatus);
    if (path.includes('/supplier-offers/') && path.endsWith('/purchase-order')) {
      calls.orders.push(route.request().postDataJSON());
      if (calls.orders.length === 1) return respond({ message: 'Изменился доступный остаток' }, 409);
      await new Promise((resolve) => setTimeout(resolve, 350));
      orders = [order];
      return respond(order, 201);
    }
    if (path === `/purchase-requests/${request.id}`) return respond(request);
    if (path === `/purchase-requests/${request.id}/accept`) {
      calls.accepts += 1;
      return respond({ ...request, status: 'CONVERTED', processedAt: date, processedBy: user, task });
    }
    if (path === `/purchase-requests/public/items/${part.id}/photo`) {
      calls.photos += 1;
      return calls.photoStatus === 200 ? route.fulfill({ body: fixtureImage, contentType: 'image/png', headers })
        : respond({}, calls.photoStatus);
    }
    if (path === '/purchase-requests/public' && method === 'POST') {
      calls.public.push(route.request().postDataJSON());
      if (calls.requestStatus === 0) return route.abort('internetdisconnected');
      if (calls.requestStatus === -1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        return respond({ id: 'late-response', number: 93, items: [] }, 201);
      }
      if (calls.requestStatus !== 200) return respond({ message: ['items.0.quantity must be a number', 'SQLSTATE QA-internal'] }, calls.requestStatus);
      return respond({ id: 'created-request', number: 92, items: [{ id: 'created-line', sortOrder: 0 }], uploadToken: 'fixture-test-token' }, 201);
    }
    if (path === '/purchase-requests/public/created-request/items/created-line/photo') {
      calls.uploads.push(route.request().headers()['x-upload-token']);
      return respond({}, calls.uploads.length === 1 ? 500 : 200);
    }
    return respond({}, 404);
  });
  return { page, context, calls, failures };
}

const goto = (page, path = '/') => page.goto(new URL(path, web).href);
const button = (page, name) => page.getByRole('button', { name, exact: true });
const text = (page, name) => page.getByText(name, { exact: true }).first().waitFor();
const main = (page) => page.getByRole('main');
const label = (page, name) => main(page).getByLabel(name, { exact: true });
async function screenshot(page, name) {
  const directory = process.env.CORE13_SCREENSHOTS;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, name), animations: 'disabled' });
}
async function noOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, page.url());
}

test('CORE-13 working screens on the production Next.js build', { timeout: 105000 }, async (suite) => {
  const browser = await chromium.launch({ channel: process.env.CORE13_BROWSER_CHANNEL || undefined });
  suite.after(() => browser.close());
  const { page, context, calls, failures } = await setup(browser);
  suite.after(() => context.close());

  await suite.test('server query, saved view, pagination and return context', async () => {
    await goto(page);
    await main(page).getByRole('link', { name: /Уплотнения испытательного стенда/ }).waitFor();
    await screenshot(page, 'purchases-1440.png');
    await button(page, 'Просроченные').click();
    await label(page, 'Сортировка').selectOption('deadline');
    await label(page, 'Поиск').fill('стенд');
    await button(page, 'Найти').click();
    await label(page, 'На странице').selectOption('10');
    await button(page, 'Сохранить вид').click();
    await text(page, 'Представление сохранено в этом браузере.');
    assert.doesNotMatch(await page.evaluate(() => localStorage.getItem('supply-manager:procurement-view')), /стенд/);
    await button(page, 'Сбросить').click();
    await button(page, 'Мой вид').click();
    assert.equal(new URL(page.url()).searchParams.get('overdue'), 'true');
    await button(page, 'Далее').click();
    assert.equal(new URL(page.url()).searchParams.get('page'), '2');
    const before = page.url();
    await main(page).getByRole('link', { name: /Закупка на второй странице/ }).click();
    await page.getByRole('link', { name: '← К списку' }).click();
    await page.waitForURL(before);
    assert.equal(page.url(), before);
    assert(calls.list.some((query) => query.get('page') === '2' && query.get('pageSize') === '10' && query.get('sort') === 'deadline'));
    calls.listStatus = 503;
    await goto(page);
    await text(page, 'Сервис временно недоступен. Повторите попытку позже.');
    calls.listStatus = 200;
    await button(page, 'Повторить').click();
    await main(page).getByRole('link', { name: /Уплотнения испытательного стенда/ }).waitFor();
    calls.listStatus = 404;
    await goto(page);
    await text(page, 'Поиск, фильтры и страницы появятся, когда сервер подключит CORE‑11.');
    calls.listStatus = 200;
  });

  await suite.test('preview, keyboard focus, photo access and request conversion', async () => {
    await goto(page, '/requests');
    const preview = page.getByRole('button', { name: /Предпросмотр заявки/ });
    await preview.click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('Тестовый заявитель', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await preview.evaluate((element) => document.activeElement === element), true);
    await preview.click();
    await button(page, 'Показать фото').click();
    await text(page, 'Недостаточно прав для этой операции.');
    assert.equal(await button(page, 'Повторить загрузку фото').count(), 0);
    await page.keyboard.press('Escape');
    await preview.click();
    calls.photoStatus = 503;
    await button(page, 'Показать фото').click();
    await text(page, 'Сервис временно недоступен. Повторите попытку позже.');
    calls.photoStatus = 200;
    await button(page, 'Повторить загрузку фото').click();
    await dialog.getByRole('img', { name: /Фото:/ }).waitFor();
    assert.equal(calls.photos, 3);
    await button(page, 'Принять в работу').click();
    await dialog.getByRole('link', { name: 'Закупка №314' }).waitFor();
    assert.equal(calls.accepts, 1);
    await page.keyboard.press('Escape');
    await main(page).getByRole('link', { name: /Комплект к испытаниям/ }).click();
    await page.getByRole('heading', { name: 'Карточка заявки' }).waitFor();
  });

  await suite.test('purchase sections, comparison and order validation, conflict and duplicate guard', async () => {
    await goto(page, `/tasks/${task.id}`);
    await text(page, 'Уточнить срок тестовой поставки');
    await screenshot(page, 'purchase-1440.png');
    await page.getByRole('button', { name: /Предложения/ }).click();
    await page.getByRole('region', { name: 'Сравнение коммерческих предложений' }).waitFor();
    await audit(page, 'offer comparison');
    await page.getByRole('button', { name: /Оформить заказ у поставщика/ }).click();
    await page.getByLabel('Количество к заказу').fill('7');
    await button(page, 'Продолжить').click();
    await page.getByText(/Введите количество от/).waitFor();
    assert(await page.getByLabel('Количество к заказу').evaluate((node) => node === document.activeElement));
    await page.getByLabel('Количество к заказу').fill('2');
    await button(page, 'Продолжить').click();
    await button(page, 'Продолжить').click();
    await text(page, 'Введите номер счёта.');
    assert(await page.getByLabel('Номер счёта', { exact: true }).evaluate((node) => node === document.activeElement));
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'Подтвердите действие' }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: /Оформить заказ/ }).waitFor();
    await page.getByLabel('Номер счёта', { exact: true }).fill('QA-314');
    await page.getByLabel('Дата счёта (местное время)').fill('2026-11-20T14:00');
    await button(page, 'Продолжить').click();
    await button(page, 'Подтвердить заказ').click();
    await page.getByRole('dialog').getByText(/Данные изменились. Карточка обновлена/).waitFor();
    await button(page, 'Подтвердить заказ').evaluate((element) => { element.click(); element.click(); });
    await page.getByRole('heading', { name: 'Заказы поставщикам' }).waitFor();
    assert.equal(calls.orders.length, 2);
    assert.deepEqual(calls.orders[1].items, [{ supplierOfferItemId: 'line-1', quantity: 2 }]);
    await button(page, 'Оплаты').click();
    await text(page, 'Оплачен');
    await button(page, 'Доставка').click();
    await text(page, 'Тестовая доставка · QA-TRACK');
    await page.getByRole('button', { name: /История/ }).first().click();
    await text(page, 'Закупка создана');
  });

  await suite.test('public wizard, inline errors, 409, photo retry and no duplicate creation', async () => {
    await goto(page, '/request');
    await button(page, 'Продолжить').click();
    await text(page, 'Введите имя заявителя.');
    assert(await label(page, 'Имя и фамилия заявителя').evaluate((node) => node === document.activeElement));
    assert.equal(await label(page, 'Имя и фамилия заявителя').getAttribute('aria-describedby'), 'request-name-error');
    await label(page, 'Имя и фамилия заявителя').fill('Тестовый заявитель');
    await button(page, 'Продолжить').click();
    await label(page, 'Наименование').fill('Синтетическая позиция');
    await label(page, 'Количество').fill('0,0001');
    await button(page, 'Продолжить').click();
    await text(page, 'Введите положительное число с точностью до тысячных.');
    await label(page, 'Количество').fill('2,125');
    await button(page, 'Продолжить').click();
    await page.locator('input[type=file]').setInputFiles({ name: 'readme.txt', mimeType: 'text/plain', buffer: Buffer.from('test') });
    await text(page, 'Выберите JPG, PNG или WebP.');
    await page.locator('input[type=file]').setInputFiles({ name: 'test-part.png', mimeType: 'image/png', buffer: fixtureImage });
    await button(page, 'Продолжить').click();
    await button(page, 'Назад').click();
    await text(page, 'test-part.png');
    await button(page, 'Продолжить').click();
    calls.requestStatus = 409;
    await button(page, 'Отправить заявку').click();
    await text(page, 'Возник конфликт изменений. Проверьте актуальные данные перед повтором.');
    calls.requestStatus = 200;
    await button(page, 'Отправить заявку').evaluate((element) => { element.click(); element.click(); });
    await page.getByRole('heading', { name: 'Заявка №92 отправлена' }).waitFor();
    await button(page, 'Повторить загрузку фото').click();
    await button(page, 'Повторить загрузку фото').waitFor({ state: 'hidden' });
    assert.equal(calls.public.length, 2);
    assert.equal(calls.public[1].items[0].quantity, 2.125);
    assert.deepEqual(calls.uploads, ['fixture-test-token', 'fixture-test-token']);

    await button(page, 'Подать ещё заявку').click();
    await label(page, 'Имя и фамилия заявителя').fill('Проверка сети');
    await button(page, 'Продолжить').click();
    await label(page, 'Наименование').fill('Позиция');
    await button(page, 'Продолжить').click();
    await button(page, 'Продолжить').click();
    calls.requestStatus = 0;
    await button(page, 'Отправить заявку').click();
    await text(page, 'Подтверждение не получено. Уточните в отделе снабжения, зарегистрирована ли заявка.');
    await text(page, 'Проверка сети');
    assert.equal(await button(page, 'Отправить заявку').isDisabled(), true);
  });

  await suite.test('all requested widths and role-restricted workspace', async () => {
    for (const width of [320, 375, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 860 });
      for (const [path, heading, name] of [
        ['/', 'Закупки', 'purchases'], ['/requests', 'Входящие заявки', 'requests'],
        [`/tasks/${task.id}?tab=items`, /№314/, 'positions'], ['/request', 'Подать заявку', 'wizard'],
        ['/registry', 'Реестр позиций', 'registry'], ['/register', 'Создание учётной записи', 'register'],
        ['/dashboard', /Здравствуйте/, 'dashboard'],
      ]) {
        await goto(page, path);
        await page.getByRole('heading', { name: heading, level: 1 }).waitFor();
        await noOverflow(page);
        if (width === 375) await screenshot(page, `${name}-375.png`);
      }
    }
    const employee = await setup(browser, 'EMPLOYEE');
    await goto(employee.page, `/tasks/${task.id}`);
    await employee.page.getByRole('heading', { name: 'Недостаточно прав' }).waitFor();
    assert.equal(await employee.page.getByText(task.title, { exact: true }).count(), 0);
    await employee.page.setViewportSize({ width: 320, height: 720 });
    await goto(employee.page, '/my-requests');
    await employee.page.getByRole('heading', { name: 'Мои заявки' }).waitFor();
    await noOverflow(employee.page);
    await employee.context.close();
  });
  assert.deepEqual(failures, []);
});

async function audit(page, name) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  assert.deepEqual(results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })), [], name);
}

test('CORE-14 keyboard, error handling and axe checks', { timeout: 105000 }, async (suite) => {
  const browser = await chromium.launch({ channel: process.env.CORE13_BROWSER_CHANNEL || undefined });
  suite.after(() => browser.close());
  const { page, context, calls, failures } = await setup(browser, 'ADMIN');
  suite.after(() => context.close());

  await suite.test('mobile drawer traps focus, Escape restores it and skip link works', async () => {
    await page.setViewportSize({ width: 320, height: 720 });
    await goto(page, '/');
    await page.getByRole('heading', { name: 'Закупки' }).waitFor();
    await page.keyboard.press('Tab');
    assert.equal(await page.locator(':focus').textContent(), 'К содержимому');
    assert.match(await page.locator(':focus').evaluate((node) => getComputedStyle(node).outlineStyle), /solid/);
    await page.keyboard.press('Enter');
    assert.equal(await page.locator(':focus').getAttribute('id'), 'workspace-main');
    const trigger = button(page, 'Открыть навигацию');
    await trigger.focus();
    await page.keyboard.press('Space');
    await page.getByRole('dialog', { name: 'Навигация' }).waitFor();
    for (const key of ['Tab', 'Shift+Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      assert(await page.evaluate(() => !!document.activeElement?.closest('dialog')));
    }
    await audit(page, 'mobile navigation');
    await screenshot(page, 'navigation-320.png');
    await page.keyboard.press('Escape');
    assert(await trigger.evaluate((node) => node === document.activeElement));
  });

  await suite.test('400 field focus, 429 delay, offline retry, no false success after 500', async () => {
    await goto(page, '/request');
    await label(page, 'Имя и фамилия заявителя').fill('Синтетический заявитель');
    await label(page, 'Имя и фамилия заявителя').press('Enter');
    assert.equal(await page.locator(':focus').textContent(), 'Комплектующие');
    await label(page, 'Наименование').fill('Синтетическая деталь');
    await label(page, 'Количество').fill('2');
    await button(page, 'Продолжить').click();
    await button(page, 'Продолжить').click();
    calls.requestStatus = 400;
    await button(page, 'Отправить заявку').click();
    await text(page, 'Проверьте поле «Количество».');
    assert.equal(await label(page, 'Количество').inputValue(), '2');
    assert.equal(await page.locator(':focus').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.getByText(/SQLSTATE/).count(), 0);
    await audit(page, 'public form with error');
    await screenshot(page, 'request-error-320.png');
    await label(page, 'Количество').fill('3');
    await button(page, 'Продолжить').click();
    await button(page, 'Продолжить').click();
    calls.requestStatus = 429;
    await button(page, 'Отправить заявку').click();
    await text(page, 'Слишком много запросов. Подождите и повторите попытку.');
    assert(await button(page, 'Отправить заявку').isDisabled());
    await button(page, 'Отправить заявку').and(page.locator('button:enabled')).waitFor();
    await context.setOffline(true);
    await text(page, 'Нет подключения к сети. Введённые данные остаются в открытой форме.');
    await button(page, 'Отправить заявку').click();
    await text(page, 'Нет подключения к сети. Подключитесь и повторите попытку.');
    assert.equal(calls.public.length, 2);
    await context.setOffline(false);
    calls.requestStatus = 500;
    await button(page, 'Отправить заявку').click();
    await text(page, 'Подтверждение не получено. Уточните в отделе снабжения, зарегистрирована ли заявка.');
    await text(page, 'Синтетический заявитель');
    assert(await button(page, 'Отправить заявку').isDisabled());
  });

  await suite.test('422 registration error restores field focus and retains input', async () => {
    await goto(page, '/register');
    await label(page, 'ФИО').fill('Тестовый сотрудник');
    await label(page, 'Логин').fill('core14fixture');
    await label(page, 'Email').fill('fixture@example.invalid');
    await label(page, 'Пароль').fill('synthetic-password');
    await label(page, 'Повторите пароль').fill('synthetic-password');
    const submit = button(page, 'Создать учётную запись');
    await submit.evaluate((node) => { node.click(); node.click(); });
    await text(page, 'Проверьте поле «Email».');
    assert.equal(calls.registrations.length, 1);
    assert.equal(await label(page, 'ФИО').inputValue(), 'Тестовый сотрудник');
    assert.equal(await page.locator(':focus').getAttribute('id'), 'register-email');
    await audit(page, 'registration with error');
    await label(page, 'Email').fill('fixed@example.invalid');
    await submit.click();
    await page.getByRole('heading', { name: 'Регистрация завершена' }).waitFor();
    assert.equal(await page.locator(':focus').textContent(), 'Регистрация завершена');
    assert.equal(await page.getByRole('link', { name: 'Перейти ко входу' }).getAttribute('href'), '/');
  });

  await suite.test('timeout keeps the reviewed draft and blocks a second creation', async () => {
    const timed = await setup(browser);
    try {
      await timed.page.addInitScript(() => {
        const timeout = AbortSignal.timeout.bind(AbortSignal);
        AbortSignal.timeout = (delay) => timeout(delay === 30_000 ? 50 : delay);
      });
      timed.calls.requestStatus = -1;
      await goto(timed.page, '/request');
      await label(timed.page, 'Имя и фамилия заявителя').fill('Проверка таймаута');
      await button(timed.page, 'Продолжить').click();
      await label(timed.page, 'Наименование').fill('Синтетическая деталь');
      await button(timed.page, 'Продолжить').click();
      await button(timed.page, 'Продолжить').click();
      await button(timed.page, 'Отправить заявку').click();
      await text(timed.page, 'Подтверждение не получено. Уточните в отделе снабжения, зарегистрирована ли заявка.');
      await text(timed.page, 'Проверка таймаута');
      assert(await button(timed.page, 'Отправить заявку').isDisabled());
      assert.equal(timed.calls.public.length, 1);
    } finally {
      await timed.context.close();
    }
  });

  await suite.test('destructive item action names the target, defaults to cancel and submits once', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page, `/tasks/${task.id}?tab=items`);
    const remove = page.getByRole('button', { name: /Удалить/ });
    await remove.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Подтвердите действие' });
    await dialog.waitFor();
    assert.match(await dialog.getByText(/будет удалена из закупки/).textContent(), new RegExp(part.name));
    assert.equal(await page.locator(':focus').textContent(), 'Отмена');
    await audit(page, 'destructive confirmation');
    await page.keyboard.press('Escape');
    assert(await remove.evaluate((node) => node === document.activeElement));
    assert.equal(calls.deletions, 0);
    await page.keyboard.press('Enter');
    await dialog.getByRole('button', { name: 'Удалить позицию' }).click();
    await text(page, 'Позиция удалена');
    assert.equal(calls.deletions, 1);
  });

  await suite.test('registry asks for a single 100-row page and distinguishes an empty filter', async () => {
    await goto(page, '/registry?pageSize=100');
    const region = page.getByRole('region', { name: 'Реестр позиций' });
    await region.getByRole('link', { name: 'Позиция 100', exact: true }).waitFor();
    assert.equal(await region.getByRole('row').count(), 101);
    const lastQuery = calls.list.at(-1);
    assert.equal(lastQuery.get('pageSize'), '100');
    await noOverflow(page);
    await label(page, 'Поиск').fill('отсутствующая позиция');
    await label(page, 'Поиск').press('Enter');
    await text(page, 'По текущим параметрам ничего не найдено');
    assert.equal(calls.list.at(-1).get('q'), 'отсутствующая позиция');
  });

  await suite.test('local 403 keeps workspace, primary 404 has back link, 503 recovers, 401 removes stale data', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    calls.nextActionStatus = 403;
    await goto(page, `/tasks/${task.id}`);
    await text(page, 'Недостаточно прав для этой операции.');
    await page.getByRole('heading', { name: /№314/ }).waitFor();
    assert.equal(await button(page, 'Повторить').count(), 0);
    calls.taskStatus = 404;
    await goto(page, `/tasks/${task.id}?back=%2Fregistry`);
    await text(page, 'Объект не найден. Возможно, он был удалён.');
    assert.equal(await page.getByRole('link', { name: 'Вернуться к списку' }).getAttribute('href'), '/registry');
    calls.listStatus = 503;
    await goto(page, '/');
    await text(page, 'Сервис временно недоступен. Повторите попытку позже.');
    assert.equal(await page.getByText(/SQLSTATE/).count(), 0);
    calls.listStatus = 200;
    await button(page, 'Повторить').click();
    await main(page).getByRole('link', { name: /Уплотнения испытательного стенда/ }).waitFor();
    await audit(page, 'purchases');
    await page.getByRole('button', { name: 'Создать закупку' }).click();
    await audit(page, 'purchase creation dialog');
    const requestsBeforeCancel = calls.list.length;
    await page.keyboard.press('Escape');
    await label(page, 'Поиск').fill('завершённая сессия');
    assert.equal(calls.list.length, requestsBeforeCancel);
    await label(page, 'Поиск').press('Enter');
    await page.getByRole('heading', { name: 'Вход в Supply Manager' }).waitFor();
    await text(page, 'Сессия завершена. Войдите повторно.');
    assert.equal(await page.getByText(task.title, { exact: true }).count(), 0);
    assert.equal(await page.locator(':focus').getAttribute('id'), 'login-name');
    await audit(page, 'session expired');
  });
  assert.deepEqual(failures, []);
});

test('CORE-13 on real NestJS, cookies and the isolated PostgreSQL fixture', {
  skip: process.env.CORE13_REAL_API !== '1', timeout: 45000,
}, async (suite) => {
  const api = 'http://127.0.0.1:3390/api/v1';
  const { Client } = require('../../api/node_modules/pg');
  const sharp = require('../../api/node_modules/sharp');
  const connectionString = process.env.CORE13_DATABASE_URL ||
    'postgresql://core13_local:core13_local@127.0.0.1:55433/core13_local?schema=e2e';
  const database = new URL(connectionString);
  if (database.protocol !== 'postgresql:' || database.hostname !== '127.0.0.1' ||
    !['55433/core13_local', '55434/core14_local'].includes(database.port + database.pathname) ||
    database.searchParams.get('schema') !== 'e2e') throw new Error('The browser regression requires the isolated local E2E database.');
  const db = new Client({ connectionString });
  await db.connect();
  suite.after(() => db.end());
  const browser = await chromium.launch({ channel: process.env.CORE13_BROWSER_CHANNEL || undefined });
  suite.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const username = 'ui13_' + randomUUID().slice(0, 8);
  const password = randomUUID();
  const register = await page.request.post(api + '/auth/register', { data: { fullName: 'Снабженец для теста', username, password } });
  assert(register.ok(), await register.text());
  const cors = await page.request.get(api + '/auth/me', { headers: { Origin: web.origin } });
  assert.equal(cors.headers()['access-control-expose-headers'], 'Retry-After');
  const { rowCount } = await db.query('UPDATE e2e."User" SET role = $1, status = $2 WHERE username = $3', ['PROCUREMENT', 'ACTIVE', username]);
  assert.equal(rowCount, 1);

  const applicant = 'Заявитель ' + username;
  const partName = 'Прокладка QA ' + username;
  const photo = await sharp({ create: { width: 80, height: 48, channels: 3, background: '#2858a5' } }).png().toBuffer();
  await goto(page, '/request');
  await label(page, 'Имя и фамилия заявителя').fill(applicant);
  await button(page, 'Продолжить').click();
  await label(page, 'Наименование').fill(partName);
  await label(page, 'Количество').fill('4');
  await button(page, 'Продолжить').click();
  await page.locator('input[type=file]').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: photo });
  await button(page, 'Продолжить').click();
  const uploaded = page.waitForResponse((response) => response.url().endsWith('/photo') && response.request().method() === 'POST');
  await button(page, 'Отправить заявку').click();
  assert((await uploaded).ok());
  await page.getByRole('heading', { name: /Заявка №.* отправлена/ }).waitFor();

  await goto(page, '/requests');
  await page.getByRole('textbox', { name: 'Логин' }).fill(username);
  await page.getByLabel('Пароль').fill(password);
  await button(page, 'Войти').click();
  const row = page.getByRole('row').filter({ hasText: applicant });
  await row.getByRole('button', { name: /Предпросмотр/ }).click();
  const photoResponse = page.waitForResponse((response) => response.url().endsWith('/photo') && response.request().method() === 'GET');
  await button(page, 'Показать фото').click();
  assert((await photoResponse).ok());
  await page.getByRole('dialog').getByRole('img', { name: /Фото:/ }).waitFor();
  await button(page, 'Принять в работу').click();
  await page.getByRole('dialog').getByRole('link', { name: /Закупка №/ }).click();
  await page.waitForURL(/\/tasks\//);
  const taskPath = new URL(page.url()).pathname;
  const details = await (await page.request.get(api + taskPath)).json();
  assert.equal(details.items.length, 1);
  await goto(page, taskPath + '?tab=offers');
  for (const [supplierName, unitPrice] of [['Поставщик QA 1', '1200'], ['Поставщик QA 2', '1300']]) {
    await page.getByRole('button', { name: /Добавить КП/ }).click();
    const form = page.getByRole('dialog', { name: 'Новое коммерческое предложение' });
    await form.getByLabel(/Поставщик/).fill(supplierName);
    await form.getByLabel('Цена за единицу, ₽').fill(unitPrice);
    await form.getByLabel('Срок поставки, дней').fill('3');
    await form.getByRole('button', { name: 'Сохранить КП' }).click();
    await form.waitFor({ state: 'hidden' });
  }
  await page.getByRole('region', { name: 'Сравнение коммерческих предложений' }).waitFor();
  await text(page, '· Цена отличается');
  await page.getByRole('button', { name: /Оформить заказ у поставщика/ }).first().click();
  await page.getByLabel('Количество к заказу').fill('1,5');
  await button(page, 'Продолжить').click();
  await page.getByLabel('Номер счёта', { exact: true }).fill('QA-REAL');
  await page.getByLabel('Дата счёта (местное время)').fill('2026-11-20T14:00');
  await button(page, 'Продолжить').click();
  await button(page, 'Подтвердить заказ').click();
  await page.getByRole('heading', { name: 'Заказы поставщикам' }).waitFor();
  const updated = await (await page.request.get(api + taskPath)).json();
  assert.equal(updated.purchaseOrders.length, 1);
  assert.equal(Number(updated.purchaseOrders[0].items[0].quantity), 1.5);
  await button(page, 'Оплаты').click();
  await text(page, 'Ожидает передачи');

  for (const [role, expectedStatus] of [['EMPLOYEE', 403], ['ADMIN', 200]]) {
    const roleContext = await browser.newContext();
    try {
      const login = 'ui14_' + randomUUID().slice(0, 8);
      assert((await roleContext.request.post(api + '/auth/register', {
        data: { fullName: 'Проверка роли ' + role, username: login, password },
      })).ok());
      const activated = await db.query('UPDATE e2e."User" SET role = $1, status = $2 WHERE username = $3', [role, 'ACTIVE', login]);
      assert.equal(activated.rowCount, 1);
      assert((await roleContext.request.post(api + '/auth/login', { data: { username: login, password } })).ok());
      const protectedData = await roleContext.request.get(api + taskPath);
      assert.equal(protectedData.status(), expectedStatus);
      const rolePage = await roleContext.newPage();
      await goto(rolePage, taskPath);
      await rolePage.getByRole('heading', { name: role === 'EMPLOYEE' ? 'Недостаточно прав' : /№\d+ ·/ }).first().waitFor();
      if (role === 'EMPLOYEE') assert.equal(await rolePage.getByText(partName, { exact: true }).count(), 0);
    } finally {
      await roleContext.close();
    }
  }
});
