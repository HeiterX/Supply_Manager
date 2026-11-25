import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { chromium } from 'playwright';

const require = createRequire(new URL('../../api/package.json', import.meta.url));
const { Client } = require('pg');
const api = new URL(process.env.CORE08_E2E_API ?? 'http://localhost:4080/api/v1/');
const web = new URL(process.env.CORE08_E2E_WEB ?? 'http://localhost:4081/');
const database = new URL(process.env.DATABASE_URL ?? 'postgresql://unused@localhost/unused');
for (const address of [api, web, database]) {
  assert(['localhost', '127.0.0.1'].includes(address.hostname), 'Use local E2E servers only');
}
assert.equal(database.searchParams.get('schema'), 'e2e', 'Use isolated PostgreSQL schema e2e');

test('partial payments and receipts update the real procurement workspace', { timeout: 90000 }, async () => {
  const browser = await chromium.launch({ channel: process.env.CORE08_CHROMIUM_CHANNEL });
  const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
  const databaseClient = new Client({ connectionString: database.toString() });
  let connected = false;
  let taskId;
  let userId;
  let supplierId;
  const username = 'core08_' + randomUUID().slice(0, 8);
  const password = 'Synthetic-E2E-Password-2026';
  const today = new Date().toISOString().slice(0, 10);
  let token;

  async function call(method, route, body) {
    const response = await context.request.fetch(new URL(route, api).href, {
      method, data: body, headers: token ? { 'X-CSRF-Token': token } : {},
    });
    assert(response.ok(), method + ' ' + route + ' returned ' + response.status() + ': ' + await response.text());
    return response.json();
  }

  try {
    await databaseClient.connect();
    connected = true;
    const account = await call('POST', 'auth/register', { fullName: 'Браузер CORE-08', username, password });
    userId = account.user.id;
    await databaseClient.query('UPDATE e2e."User" SET role = $1, status = $2 WHERE id = $3', ['ADMIN', 'ACTIVE', userId]);
    await call('POST', 'auth/login', { username, password });
    token = (await call('GET', 'auth/csrf')).csrfToken;

    taskId = (await call('POST', 'tasks', { title: 'Синтетическая закупка CORE-08' })).id;
    const task = 'tasks/' + taskId;
    const item = await call('POST', task + '/items', { name: 'Подшипник для проверки CORE-08', quantity: 3, unit: 'шт.' });
    const offer = await call('POST', task + '/supplier-offers', {
      supplierName: 'Поставщик CORE-08 ' + username, currency: 'RUB',
      items: [{ taskItemId: item.id, quantity: 3, currency: 'RUB', unitPrice: 50 }],
    });
    supplierId = offer.supplierId;
    await call('PATCH', task + '/supplier-offers/' + offer.id + '/decision', { reason: 'Синтетический сценарий проверки интерфейса' });
    await call('POST', task + '/supplier-offers/' + offer.id + '/purchase-order', {
      invoiceNumber: 'CORE08-BROWSER', invoiceDate: today,
      items: [{ supplierOfferItemId: offer.items[0].id, quantity: 3 }],
    });

    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', event => {
      if (event.type() === 'error') errors.push(event.text());
    });
    page.on('dialog', dialog => void dialog.accept());
    await page.goto(new URL(task, web).href);
    assert.equal(new URL(page.url()).pathname, '/' + task);
    assert.match(await page.title(), /Supply Manager/i);
    await page.getByRole('button', { name: /^Заказы/ }).click();
    const ledger = page.getByRole('region', { name: 'Счета, поставки и приёмка' });
    await ledger.getByRole('heading', { name: 'Исполнение по позициям' }).waitFor();
    await ledger.getByText('Счета ещё не зарегистрированы.').waitFor();
    assert.equal(await ledger.getByRole('button', { name: 'Закрыть закупку' }).isDisabled(), true);

    async function operation(label, fields = {}) {
      await ledger.getByRole('button', { name: label, exact: true }).click();
      const form = ledger.getByRole('form', { name: label });
      for (const [name, value] of Object.entries(fields)) await form.getByLabel(name, { exact: true }).fill(value);
      const saving = page.waitForResponse(response =>
        response.request().method() === 'POST' && response.url().endsWith('/fulfillment'));
      await form.getByRole('button', { name: 'Сохранить' }).click();
      const response = await saving;
      assert.equal(response.status(), 201, await response.text());
      await form.waitFor({ state: 'hidden' });
    }

    await operation('Добавить счёт', { Сумма: '150' });
    await operation('Согласовать счёт');
    await operation('Записать платёж', { Сумма: '50', 'Номер подтверждения': 'BROWSER-P1' });
    await ledger.getByText(/Оплачено 50 · Остаток 100/).waitFor();
    await operation('Создать партию', { 'Номер партии': 'BROWSER-LOT', 'Подшипник для проверки CORE-08 (шт.)': '3' });
    await operation('Отметить отгрузку', { Перевозчик: 'Тестовый перевозчик', 'Трек-номер': 'SYNTHETIC' });
    await operation('Отметить прибытие');
    await operation('Принять', { Количество: '1' });
    await ledger.getByText(/Заказано 3 · Принято 1 · Осталось получить 2/).waitFor();
    assert.equal(await ledger.getByRole('button', { name: 'Закрыть закупку' }).isDisabled(), true);
    if (process.env.CORE08_SCREENSHOTS) {
      await ledger.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(process.env.CORE08_SCREENSHOTS, 'core08-desktop.png') });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    if (process.env.CORE08_SCREENSHOTS) {
      await ledger.getByRole('heading', { name: 'Счета и оплаты' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(process.env.CORE08_SCREENSHOTS, 'core08-mobile.png') });
    }
    await operation('Записать платёж', { Сумма: '100', 'Номер подтверждения': 'BROWSER-P2' });
    await operation('Принять', { Количество: '2' });
    await operation('Передать получателю', { Количество: '3', Получатель: 'Тестовый получатель' });
    const closing = page.waitForResponse(response => response.url().endsWith('/orders/close'));
    await ledger.getByRole('button', { name: 'Закрыть закупку' }).click();
    assert.equal((await closing).status(), 200);
    await ledger.getByRole('button', { name: 'Закрыть закупку' }).waitFor({ state: 'hidden' });
    assert.equal((await call('GET', task + '/fulfillment')).locked, true);
    assert.equal(await page.locator('nextjs-portal').count(), 0, 'No development error overlay');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    if (connected) {
      try {
        if (taskId) {
          await databaseClient.query('BEGIN');
          const orderIds = '(SELECT id FROM e2e."PurchaseOrder" WHERE "taskId" = $1)';
          for (const sql of [
            'DELETE FROM e2e."FulfillmentOperation" WHERE "taskId" = $1',
            'DELETE FROM e2e."FulfillmentEvent" WHERE "purchaseOrderItemId" IN (SELECT id FROM e2e."PurchaseOrderItem" WHERE "purchaseOrderId" IN ' + orderIds + ')',
            'DELETE FROM e2e."ShipmentItem" WHERE "shipmentId" IN (SELECT id FROM e2e."Shipment" WHERE "purchaseOrderId" IN ' + orderIds + ')',
            'DELETE FROM e2e."Shipment" WHERE "purchaseOrderId" IN ' + orderIds,
            'DELETE FROM e2e."Payment" WHERE "invoiceId" IN (SELECT id FROM e2e."Invoice" WHERE "purchaseOrderId" IN ' + orderIds + ')',
            'DELETE FROM e2e."Invoice" WHERE "purchaseOrderId" IN ' + orderIds,
            'UPDATE e2e."Task" SET "currentPurchaseOrderId" = NULL, "selectedOfferId" = NULL WHERE id = $1',
            'DELETE FROM e2e."Task" WHERE id = $1',
          ]) await databaseClient.query(sql, [taskId]);
          await databaseClient.query('COMMIT');
        }
        if (supplierId) await databaseClient.query('DELETE FROM e2e."Supplier" WHERE id = $1', [supplierId]);
        if (userId) await databaseClient.query('DELETE FROM e2e."User" WHERE id = $1', [userId]);
      } finally {
        await databaseClient.end();
      }
    }
  }
});
