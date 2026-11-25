import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiConnectionError, apiError, apiMessage, couldHaveSaved, retryDeadline } from '../lib/api-error.ts';

test('API status codes use predefined messages and keep raw responses out of the UI', async () => {
  const apiDetails = 'SQLSTATE qa internals';
  for (const status of [400, 401, 403, 404, 409, 422, 429, 500, 503]) {
    const error = await apiError(Response.json({ message: apiDetails }, { status }), 'Безопасное сообщение');
    assert.equal(error.status, status);
    assert.doesNotMatch(error.message, /SQLSTATE/);
    assert.equal(couldHaveSaved(error), status >= 500);
  }
  assert.equal(apiMessage(new Error(apiDetails), 'Ошибка запроса'), 'Ошибка запроса');
});

test('only known validation fields produce field errors', async () => {
  const error = await apiError(Response.json({ message: [
    'items.0.quantity must be positive', 'token must be a string', 'constructor details', 'name SQLSTATE',
  ] }, { status: 422 }), 'Ошибка', { 'items.0.quantity': 'Количество', name: 'Наименование' });
  assert.deepEqual(error.fields, {
    'items.0.quantity': 'Проверьте поле «Количество».', name: 'Проверьте поле «Наименование».',
  });
});

test('Retry-After supports delay seconds and HTTP dates', () => {
  const now = Date.parse('2026-11-23T00:00:00Z');
  assert.equal(retryDeadline('10', now), now + 10_000);
  assert.equal(retryDeadline('Mon, 23 Nov 2026 00:00:20 GMT', now), now + 20_000);
  for (const value of ['0', '-2', 'invalid', null, '999999999999999999']) assert.equal(retryDeadline(value, now), null);
});

test('offline before sending is retryable while timeouts and connection loss can hide a successful write', () => {
  assert.equal(couldHaveSaved(new ApiConnectionError('offline')), false);
  assert.equal(couldHaveSaved(new ApiConnectionError('timeout')), true);
  assert.equal(couldHaveSaved(new ApiConnectionError('network')), true);
});
