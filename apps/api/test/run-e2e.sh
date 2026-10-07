#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f ".env" ]; then
  echo "Ошибка: apps/api/.env не найден"
  exit 1
fi

if [ ! -f ".env.test" ]; then
  echo "Ошибка: apps/api/.env.test не найден"
  exit 1
fi

set -a
source .env
source .env.test
set +a

export NODE_ENV=test

echo "E2E database: PostgreSQL schema 'e2e'"

npx prisma migrate deploy
npx vitest run --config ./vitest.config.e2e.ts
