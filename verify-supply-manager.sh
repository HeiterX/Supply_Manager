#!/usr/bin/env bash
set -euo pipefail
if [[ ! -f apps/api/package.json || ! -f apps/web/package.json ]]; then
  echo 'Запустите скрипт из корня проекта'
  exit 1
fi
(
  cd apps/api
  npx prisma generate
  npm run build
  npm run test:e2e
)
(
  cd apps/web
  npm run build
)
echo 'Все команды завершились успешно.'
