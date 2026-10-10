#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "ОШИБКА: apps/api/.env не найден"
  exit 1
fi

if [ ! -f .env.test ]; then
  echo "ОШИБКА: apps/api/.env.test не найден"
  exit 1
fi

# Load production/development settings first, then override with test settings.
set -a
source .env
SUPPLY_MANAGER_DEV_DATABASE_URL="${DATABASE_URL:-}"
source .env.test
set +a

export NODE_ENV=test
export SUPPLY_MANAGER_DEV_DATABASE_URL

# Stop BEFORE migrations/tests if the effective test URL is not safely isolated.
node --input-type=module <<'JS'
function stop(message) {
  console.error(`ОШИБКА: ${message}`);
  process.exit(1);
}

const development = process.env.SUPPLY_MANAGER_DEV_DATABASE_URL;
const testing = process.env.DATABASE_URL;
if (!development || !testing) {
  stop('В .env и .env.test должны быть заданы DATABASE_URL');
}
if (development === testing) {
  stop('.env.test не переопределил DATABASE_URL: тесты могли бы использовать рабочую базу');
}

let devUrl;
let testUrl;
try {
  devUrl = new URL(development);
  testUrl = new URL(testing);
} catch {
  stop('Некорректный DATABASE_URL');
}

if (!['postgresql:', 'postgres:'].includes(testUrl.protocol)) {
  stop('Тестовый DATABASE_URL должен использовать PostgreSQL');
}
if (testUrl.searchParams.get('schema') !== 'e2e') {
  stop('Тестовый DATABASE_URL обязан содержать ?schema=e2e');
}
if (devUrl.searchParams.get('schema') === 'e2e' &&
    devUrl.hostname === testUrl.hostname &&
    devUrl.port === testUrl.port &&
    devUrl.pathname === testUrl.pathname) {
  stop('Рабочая и тестовая конфигурации указывают на одну схему e2e');
}

console.log('E2E: изолированная схема e2e подтверждена в конфигурации');
console.log(`E2E: сервер ${testUrl.hostname}, база ${decodeURIComponent(testUrl.pathname.slice(1))}`);
JS

unset SUPPLY_MANAGER_DEV_DATABASE_URL

npx prisma migrate deploy
npx vitest run --config ./vitest.config.e2e.ts
