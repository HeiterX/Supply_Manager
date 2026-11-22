import { parse } from 'dotenv';

// Parse files as data, never as shell programs; require an explicit test URL.
export function createE2eEnvironment(developmentText, testingText, inherited = {}) {
  const development = parse(developmentText);
  const testing = parse(testingText);
  if (!development.DATABASE_URL || !testing.DATABASE_URL) {
    throw new Error('DATABASE_URL must be explicitly set in both .env and .env.test');
  }
  let devUrl;
  let testUrl;
  try {
    devUrl = new URL(development.DATABASE_URL);
    testUrl = new URL(testing.DATABASE_URL);
  } catch {
    throw new Error('Invalid DATABASE_URL in E2E configuration');
  }
  if (![devUrl, testUrl].every(url => ['postgres:', 'postgresql:'].includes(url.protocol))) {
    throw new Error('E2E configuration requires PostgreSQL URLs');
  }
  if (testUrl.searchParams.getAll('schema').length !== 1 ||
      testUrl.searchParams.get('schema') !== 'e2e') {
    throw new Error('Test DATABASE_URL must specify exactly one schema=e2e');
  }
  // Include loopback aliases and PostgreSQL's implicit port in the comparison.
  const host = url => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    ? 'loopback' : url.hostname;
  if (devUrl.searchParams.getAll('schema').includes('e2e') &&
      host(devUrl) === host(testUrl) &&
      (devUrl.port || '5432') === (testUrl.port || '5432') &&
      decodeURIComponent(devUrl.pathname) === decodeURIComponent(testUrl.pathname)) {
    throw new Error('Development and test configurations target the same e2e schema');
  }
  // Development-only integrations (e.g. Telegram) are not loaded from .env.
  return { ...inherited, ...testing, NODE_ENV: 'test', DATABASE_URL: testing.DATABASE_URL };
}
