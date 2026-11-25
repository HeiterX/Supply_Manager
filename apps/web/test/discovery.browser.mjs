import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { seedDiscoveryBrowser } from '../../api/test/discovery-browser-fixture.mjs';

const web = process.env.CORE11_BROWSER_WEB ?? 'http://localhost:3381';
const api = process.env.CORE11_BROWSER_API ?? 'http://localhost:3380/api/v1';
const screenshots = process.env.CORE11_BROWSER_SCREENSHOTS;
for (const value of [web, api]) {
  if (!['127.0.0.1', 'localhost'].includes(new URL(value).hostname)) {
    throw new Error('Browser tests require local API and Web servers');
  }
}

async function login(page, user, route = '/') {
  page.setDefaultTimeout(10000);
  await page.goto(web + route);
  await page.getByRole('textbox', { name: 'Логин' }).fill(user.username);
  await page.getByLabel('Пароль').fill(user.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Поиск по Supply Manager' }).waitFor()
    .catch(async (error) => {
      throw new Error(`Login at ${page.url()} did not open the workspace. ${await page.locator('body').innerText()}`, { cause: error });
    });
}

async function screenshot(page, name) {
  if (!screenshots) return;
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: join(screenshots, name), animations: 'disabled' });
}

test('CORE-11 against the production Web build and isolated API', { timeout: 90000 }, async (suite) => {
  const fixture = await seedDiscoveryBrowser(api);
  suite.after(fixture.cleanup);
  const browser = await chromium.launch({
    channel: process.env.CORE11_BROWSER_CHANNEL || undefined, headless: true,
  });
  suite.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const uncaught = [];
  page.on('pageerror', (error) => uncaught.push(error.message));
  await login(page, fixture.procurement);

  await suite.test('URL filters, server pagination, return link and downloads', async () => {
    const main = page.getByRole('main');
    await main.getByRole('searchbox', { name: 'Поиск', exact: true }).fill(fixture.marker);
    await main.getByRole('combobox', { name: 'Приоритет', exact: true }).selectOption('HIGH');
    await main.getByRole('button', { name: 'Применить' }).click();
    await main.getByText('Найдено 27', { exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('priority'), 'HIGH');
    await main.getByRole('button', { name: 'Далее', exact: true }).click();
    await main.getByText('Страница 2 из 2').waitFor();
    const secondPage = page.url();
    const row = main.getByRole('link', { name: new RegExp(fixture.marker) }).first();
    await row.click();
    await page.getByRole('link', { name: '← К списку' }).click();
    await main.getByText('Страница 2 из 2').waitFor();
    assert.equal(page.url(), secondPage);
    for (const format of ['CSV', 'XLSX']) {
      const downloaded = page.waitForEvent('download');
      await main.getByRole('button', { name: `Скачать ${format}`, exact: true }).click();
      assert.match((await downloaded).suggestedFilename(), new RegExp(`^supply-manager-tasks-.*\\.${format.toLowerCase()}$`));
    }
  });

  await suite.test('global search debounces and ignores an aborted response', async () => {
    const requests = [];
    const observed = Promise.withResolvers();
    const release = Promise.withResolvers();
    const delayTerm = 'старый-запрос';
    const route = async (intercept) => {
      const term = new URL(intercept.request().url()).searchParams.get('q');
      requests.push(term);
      if (term === delayTerm) {
        observed.resolve();
        await release.promise;
        await intercept.fulfill({
          json: {
            total: 1, page: 1, pageSize: 8, hasPrevious: false, hasNext: false,
            items: [{ entity: 'tasks', id: 'stale', title: 'Устаревшая строка', href: '/' }],
          },
        }).catch(() => {});
      } else {
        await intercept.continue();
      }
    };
    await page.route('**/discovery/search?*', route);
    try {
      const search = page.getByRole('searchbox', { name: 'Поиск по Supply Manager' });
      await search.fill(delayTerm);
      await observed.promise;
      const aborted = page.waitForEvent('requestfailed', {
        predicate: (request) => new URL(request.url()).searchParams.get('q') === delayTerm,
      });
      const finalTerm = `АРТ-${fixture.marker.slice(7)}`;
      await search.fill('промежуточный-запрос');
      await search.fill(finalTerm);
      await aborted;
      const results = page.getByRole('list', { name: 'Результаты поиска' });
      const hit = results.getByRole('link', { name: /Криогенный разъём/ });
      await hit.waitFor();
      release.resolve();
      assert.deepEqual(requests, [delayTerm, finalTerm]);
      assert.equal(await results.getByText('Устаревшая строка').count(), 0);
      await screenshot(page, 'search.png');
      await hit.click();
      await page.getByRole('main').getByText('Криогенный разъём', { exact: true }).first().waitFor();
      assert.match(page.url(), /tab=items#items-/);
    } finally {
      release.resolve();
      await page.unroute('**/discovery/search?*', route);
    }
  });

  await suite.test('analytics, supplier history, delivery link and mobile width', async () => {
    await page.goto(`${web}/analytics?from=2025-02-01&to=2025-02-01`);
    await page.getByRole('heading', { name: 'Статусы заказов, оформленных за период' }).waitFor();
    await page.getByRole('region', { name: 'Таблица по месяцам' }).getByText('2025-02', { exact: true }).waitFor();
    await page.getByText('200,25 RUB', { exact: true }).first().waitFor();
    await screenshot(page, 'analytics-desktop.png');
    const report = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать CSV' }).click();
    assert.match((await report).suggestedFilename(), /^supply-manager-analytics-.*\.csv$/);
    await page.getByRole('link', { name: fixture.supplier.name, exact: true }).click();
    await page.getByRole('heading', { name: 'История заказов и закупок' }).waitFor();
    await page.getByRole('link', { name: `Счёт № ${fixture.order.invoiceNumber}` }).click();
    await page.waitForURL(/tab=order#order-/);
    await page.locator(`[id="order-${fixture.order.id}"]`).getByText(`Счёт № ${fixture.order.invoiceNumber}`, { exact: false }).waitFor();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${web}/analytics?from=2025-02-01&to=2025-02-01`);
    await page.getByRole('heading', { name: 'Аналитика', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Оплаты', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await screenshot(page, 'analytics-mobile.png');
    await page.goto(`${web}/analytics?from=2023-01-01&to=2023-01-01`);
    await page.getByText('За этот период нет событий.').waitFor();
    assert.deepEqual(uncaught, []);
  });

  await suite.test('401, 403 and network errors show the correct UI', async () => {
    const guest = await browser.newContext();
    try {
      const employee = await guest.newPage();
      await employee.goto(`${web}/requests`);
      await employee.getByRole('heading', { name: 'Вход в Supply Manager' }).waitFor();
      await login(employee, fixture.employee, '/requests');
      await employee.getByRole('heading', { name: 'Мои заявки' }).waitFor();
      await employee.getByText(fixture.own.title, { exact: true }).waitFor();
      assert.equal(await employee.getByText('Чужая заявка', { exact: false }).count(), 0);
      const forbidden = await employee.request.get(`${api}/discovery/lists/orders`);
      assert.equal(forbidden.status(), 403);
      await employee.goto(`${web}/analytics`);
      await employee.getByRole('heading', { name: 'Недостаточно прав' }).waitFor();
    } finally {
      await guest.close();
    }
    await page.route(/\/discovery\/analytics(?:\?|$)/, (route) => route.abort('failed'));
    await page.goto(`${web}/analytics`);
    await page.getByRole('alert').getByText(/Сервер недоступен/).waitFor();
    await page.unroute(/\/discovery\/analytics(?:\?|$)/);
    await page.getByRole('button', { name: 'Повторить' }).click();
    await page.getByRole('heading', { name: 'Оплаты', exact: true }).waitFor();
  });
});
