import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { core09Request, Core09Error, errorMessage, formatActionDate, loadActions, loadNotices, uniqueById, pageFromQuery } from '../lib/core09-api.ts';

const originalFetch = globalThis.fetch;
test('pagination rejects invalid, infinite, fractional and negative URL values', () => {
  for (const value of [null, '', '-1', 'NaN', 'Infinity', '2.5', '99999999999999999999']) assert.equal(pageFromQuery(value), 1);
  assert.equal(pageFromQuery('3'), 3);
});
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

test('actions send server filter, personal scope, search and due-date sort with cookie credentials', async () => {
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/api/v1/next-actions');
    assert.equal(url.searchParams.get('filter'), 'overdue');
    assert.equal(url.searchParams.get('scope'), 'mine');
    assert.equal(url.searchParams.get('q'), 'Фильтр & насос');
    assert.equal(url.searchParams.get('page'), '2');
    assert.equal(url.searchParams.get('sort'), 'dueAt');
    assert.equal(options?.credentials, 'include');
    assert.equal(options?.cache, 'no-store');
    assert.ok(options?.signal);
    return Response.json({ items: [], counts: { overdue: 9 }, total: 9 });
  };
  const data = await loadActions('overdue', 'Фильтр & насос', 2, new AbortController().signal);
  assert.equal(data.counts.overdue, 9);
});

test('all urgency filters are passed to the server without client-side date inference', async () => {
  for (const filter of ['all', 'today', 'overdue', 'waiting_supplier'] as const) {
    globalThis.fetch = async input => {
      assert.equal(new URL(String(input)).searchParams.get('filter'), filter);
      return Response.json({ items: [{ id: 'a', dueAt: '2000-01-01T00:00:00Z', status: 'PLANNED' }] });
    };
    const data = await loadActions(filter, '', 1, new AbortController().signal);
    assert.equal(data.items[0].status, 'PLANNED');
  }
});

test('notifications send unread filter, pagination and preserve authoritative unread count', async () => {
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('filter'), 'unread');
    assert.equal(url.searchParams.get('page'), '3');
    return Response.json({ items: [], unreadCount: 34, total: 34 });
  };
  assert.equal((await loadNotices('unread', 3, new AbortController().signal)).unreadCount, 34);
});

test('401 and 403 dispatch existing AuthGate events and do not return protected data', async () => {
  const window = new EventTarget();
  Object.defineProperty(globalThis, 'window', { value: window, configurable: true });
  for (const [status, name] of [[401, 'supply-manager:unauthorized'], [403, 'supply-manager:forbidden']] as const) {
    let count = 0;
    window.addEventListener(name, () => count++);
    globalThis.fetch = async () => Response.json({ secret: 'should-never-be-rendered' }, { status });
    await assert.rejects(core09Request('/notifications', new AbortController().signal), error => error instanceof Core09Error && error.status === status);
    assert.equal(count, 1);
  }
});

test('404, 409 and 500 have distinct safe errors without echoing server internals', async () => {
  for (const status of [404, 409, 500]) {
    globalThis.fetch = async () => Response.json({ message: 'private-stack-or-token' }, { status });
    await assert.rejects(core09Request('/next-actions', new AbortController().signal), error => {
      assert.ok(error instanceof Core09Error);
      assert.equal(error.status, status);
      assert.ok(!error.message.includes('private-stack-or-token'));
      return true;
    });
  }
});

test('aborted requests retain their cancellation signal', async () => {
  const controller = new AbortController();
  controller.abort();
  globalThis.fetch = async (_input, options) => {
    assert.equal(options?.signal?.aborted, true);
    options?.signal?.throwIfAborted();
    return Response.json({});
  };
  await assert.rejects(loadNotices('all', 1, controller.signal), { name: 'AbortError' });
});

test('read mutation uses PATCH, cookies and handles 204 without trying to parse JSON', async () => {
  globalThis.fetch = async (input, options) => {
    assert.ok(String(input).endsWith('/notifications/notice-id/read'));
    assert.equal(options?.method, 'PATCH');
    assert.equal(options?.credentials, 'include');
    return new Response(null, { status: 204 });
  };
  assert.equal(await core09Request('/notifications/notice-id/read', new AbortController().signal, { method: 'PATCH' }), undefined);
});

test('duplicate event IDs are rendered once with the latest server read state', () => {
  assert.deepEqual(uniqueById([{ id: 'a', readAt: null }, { id: 'a', readAt: '2026-11-22' }, { id: 'b', readAt: null }]), [{ id: 'a', readAt: '2026-11-22' }, { id: 'b', readAt: null }]);
  assert.deepEqual(uniqueById([]), []);
});

test('formatting respects server timezone across a date boundary, invalid dates and unset dates', () => {
  assert.match(formatActionDate('2026-11-21T22:00:00Z', 'Europe/Moscow'), /22.*нояб.*2026.*01:00/);
  assert.match(formatActionDate('2026-11-21T22:00:00Z', 'UTC'), /21.*нояб.*2026.*22:00/);
  assert.equal(formatActionDate('invalid'), 'Дата недоступна');
  assert.equal(formatActionDate(null), 'Не задан');
});

test('network failures show a useful safe message', async () => {
  globalThis.fetch = async () => { throw new TypeError('network with internal hostname'); };
  await assert.rejects(loadNotices('all', 1, new AbortController().signal));
  assert.match(errorMessage(new TypeError('private-host')), /Сервер недоступен/);
  assert.ok(!errorMessage(new TypeError('private-host')).includes('private-host'));
});
