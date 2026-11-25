# Supply Manager

Веб-приложение для управления заявками и закупками комплектующих судоремонтного предприятия. Текущий репозиторий содержит NestJS API, Next.js frontend и PostgreSQL/Prisma 7. Интеллектуальные функции (IMAP, извлечение КП, прогноз рисков) — отдельные последующие этапы, а не часть проверяемого CI-ядра.

## Требования

- Windows, Linux или WSL2; Docker Desktop / Docker Engine и Docker Compose.
- Node.js **24** и npm (версии зависимостей зафиксированы **отдельно** в `apps/api/package-lock.json` и `apps/web/package-lock.json`).
- Порты: PostgreSQL 5432, API 3000, frontend 3001.

**Не используйте реальные письма, счета, фотографии, секреты или дампы БД в публичном репозитории.** Файлы `.env` и `.env.test` локальные и не должны попадать в Git.

## Первый запуск (локально)

Из корня репозитория:

```bash
docker compose up -d postgres
cd apps/api
npm ci
```

В VS Code создайте **локальный**, игнорируемый Git файл `apps/api/.env`:

```dotenv
DATABASE_URL=postgresql://supply:supply_dev_password@localhost:5432/supply_manager?schema=public
JWT_SECRET=replace-with-your-own-random-secret-at-least-32-characters
FRONTEND_ORIGIN=http://localhost:3001
```

`supply_dev_password` здесь — **только пароль из локального `compose.yaml`**, он не подходит для промышленного развёртывания. Для нового JWT-секрета используйте, например, `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Не публикуйте полученное значение.

Примените миграции **к локальной базе разработки** и запустите API:

```bash
npx prisma generate
npx prisma migrate deploy
npm run start:dev
```

В другом терминале:

```bash
cd apps/web
npm ci
npm run dev -- -p 3001
```

- Frontend: http://localhost:3001
- API: http://localhost:3000/api/v1
- `/request` — публичная подача заявки; `/requests`, `/`, `/registry`, `/tasks/[id]` — защищённые разделы.
- Создание/активация учётных записей с ролью PROCUREMENT или ADMIN выполняется по утверждённой процедуре, не через самостоятельное повышение прав публичного пользователя.

### Запуск локальных E2E

Переносимый `apps/api/test/run-e2e.mjs` требует `apps/api/.env` (для сравнения адресов) и `apps/api/.env.test` (тестовая конфигурация). Bash/WSL для тестов не нужен. Оба файла должны явно задавать `DATABASE_URL`; адрес не наследуется из окружения. Используйте отдельный PostgreSQL 17 контейнер и тестовую БД, обязательно со схемой `e2e`. Например, только для локальных синтетических данных:

```bash
docker run --name supply-e2e -e POSTGRES_USER=supply_test -e POSTGRES_PASSWORD=test_only_password -e POSTGRES_DB=supply_manager_e2e -p 127.0.0.1:55442:5432 -d postgres:17-alpine
```

В `.env.test`:

```dotenv
DATABASE_URL=postgresql://supply_test:test_only_password@127.0.0.1:55442/supply_manager_e2e?schema=e2e
JWT_SECRET=use-a-unique-local-test-secret-at-least-32-characters
```

Убедитесь, что `.env.test` указывает только на тестовый контейнер. Runner проверяет конфигурацию **до миграций**, загружает dotenv как данные и запускает локальные Prisma/Vitest. `.env` не загружается в тестовые процессы; `dotenv/config` также направлен на `.env.test`. Проверка схемы не определяет, является ли сервер производственным: никогда не подставляйте производственные URL. Старый `run-e2e.sh` оставлен как совместимая обёртка.

```bash
cd apps/api
npm run lint
npm run build
npm test
npm run test:e2e:safety
npm run test:e2e
```

В frontend:

```bash
cd apps/web
npm run lint
npm run build
```

## CI на Pull Request

Workflow: [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

- **API:** `npm ci`, `prisma generate`, lint/build, unit, тесты защиты конфигурации, E2E.
- **E2E:** только служебный PostgreSQL 17, который GitHub Actions создаёт на время задания; база `supply_manager_ci`, отдельная схема `e2e`. Тестовый JWT-секрет фиктивный; не используется ни один корпоративный секрет.
- **Web:** `npm ci`, `npm run lint`, `npm run build` (включая проверку TypeScript).
- **Repository hygiene:** проверка отслеживаемых имён на `.env`, базы/дампы, вложения, backups, архивы, ключи и локальные модели; Gitleaks 8.30.1 проверяет новые коммиты с маскированием значений. Исторический аудит SM-005 и отзыв ранее опубликованных данных остаются отдельной задачей.
- **npm audit:** выполняется отдельно для API и Web на production-зависимостях; результат отображается в логах PR. Это информационная проверка до принятия решения об обновлениях. Не применяйте `npm audit fix --force` вслепую.

Для полного запуска на новой машине нужны только `git checkout`, Node/npm, Docker и разрешение GitHub Actions на запуск. Глобальный `npm install`, доступ к личной БД, почте или Ollama **не требуются**.

## Ручная регрессия

После прохождения CI выполняйте [чек-лист SM-007](docs/SM-007-regression-checklist.md) в браузере и тестовом окружении. Автоматические API E2E **не заменяют** ручную проверку интерфейса и фотозагрузки. Результаты подтверждаются человеком в PR/Issue.

## Известные ограничения и незакрытые вопросы

1. **Стабилизация:** SM-002–SM-007 интегрированы в `main`. Актуальные результаты CORE-02, среда и ограничения — в [отчёте](docs/CORE-02-report.md).
2. **Lint/build:** оба приложения проходят проверки без отключения правил; повторять проверки после изменения зависимостей.
3. **Frontend:** отдельного `npm test` и браузерных E2E сейчас нет. Next.js проверяется lint + production build, а критические пользовательские сценарии — ручным smoke test.
4. **Секреты/вложения:** имя файла — лишь сигнал риска. Исторические коммиты, содержимое резервных копий и конфиденциальные вложения требуют отдельной ревизии SM-005. Не публикуйте найденные секреты в Issues; при утечке ключи отзываются.
5. **Безопасность фото:** SM-004 интегрирована; API E2E и браузерная проверка CORE-02 подтверждают uploadToken и защищённое чтение.
6. **Аудит зависимостей (22.11.2026):** Web production — 0; API — 3 high одной цепочки Prisma/Effect, см. [Issue #38](https://github.com/HeiterX/Supply_Manager/issues/38). Audit в CI информационный: зелёный CI не означает отсутствие уязвимостей.
7. **Production:** локальные пароли из Compose, HTTP и тестовые токены предназначены только для разработки. HTTPS, защищённое хранение секретов, резервное копирование и мониторинг потребуют отдельной подготовки перед пилотом.

Проект не следует считать готовым к промышленной эксплуатации на основании одного успешного CI.
