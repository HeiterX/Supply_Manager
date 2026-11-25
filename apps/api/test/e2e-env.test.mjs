import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createE2eEnvironment } from './e2e-env.mjs';

const dev = 'DATABASE_URL=postgresql://dev:dummy@localhost/project?schema=public';
const isolated = 'DATABASE_URL=postgresql://test:dummy@127.0.0.1:5432/project?schema=e2e';

await test('requires test URL in the file instead of inheriting it', () => {
  assert.throws(() => createE2eEnvironment(dev, 'JWT_SECRET=dummy', {
    DATABASE_URL: isolated.slice('DATABASE_URL='.length),
  }), /explicitly/);
  assert.throws(() => createE2eEnvironment('', isolated), /explicitly/);
});

await test('rejects non-PostgreSQL, invalid and ambiguous/public schemas', () => {
  for (const value of ['invalid', 'file:local.db',
    'postgresql://localhost/project', 'postgresql://localhost/project?schema=public',
    'postgresql://localhost/project?schema=e2e&schema=public']) {
    assert.throws(() => createE2eEnvironment(dev, `DATABASE_URL=${value}`));
  }
});

await test('rejects working e2e despite credentials, host aliases or port spelling', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    assert.throws(() => createE2eEnvironment(
      `DATABASE_URL=postgres://other:dummy@${hostname}/project?schema=e2e`, isolated,
    ), /same e2e schema/);
  }
});

await test('allows a distinct database or a public development schema', () => {
  for (const development of [dev, dev.replace('project?schema=public', 'other?schema=e2e')]) {
    const env = createE2eEnvironment(development, `${isolated}\nJWT_SECRET=test-only`, {
      NODE_ENV: 'production', DATABASE_URL: 'ignored',
    });
    assert.equal(env.NODE_ENV, 'test');
    assert.equal(env.DATABASE_URL, isolated.slice('DATABASE_URL='.length));
    assert.equal(env.JWT_SECRET, 'test-only');
  }
});

await test('does not load development integrations or execute shell syntax', () => {
  const env = createE2eEnvironment(`${dev}\nTELEGRAM_BOT_TOKEN=development-only`,
    `${isolated}\nJWT_SECRET='literal-$value;$(command)'`);
  assert.equal(env.TELEGRAM_BOT_TOKEN, undefined);
  assert.equal(env.JWT_SECRET, 'literal-$value;$(command)');
});
