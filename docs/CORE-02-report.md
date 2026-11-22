# CORE-02 — стабилизация кодовой базы и CI

Дата проверки: 22.11.2026. Related to [#23](https://github.com/HeiterX/Supply_Manager/issues/23).
Ветка: `feature/core-02-ci-stabilization`, база `origin/main` — `aa70d7f`.

## Исходное состояние

Изучены #23, закрытые #13/#14 и слитые PR #21/#19, README, отчёты SM-005/007, workflow, scripts и lockfiles обоих приложений, Prisma schema/migrations и существующие тесты. Основная рабочая копия имеет массовые staged-удаления: она не изменялась. От свежего origin/main создан отдельный worktree `.core02-audit`.

SM-002–SM-007 уже интегрированы. Исправления Hooks, AuthGate, apiFetch, cookie-JWT, uploadToken и transaction-local search_path уже присутствуют. Повторно исправлять их не требовалось. Предыдущий CI PR #19 [run #7](https://github.com/HeiterX/Supply_Manager/actions/runs/44516637566) успешен, но не запускал unit-тесты и оставлял audit информационным.

Среда: Windows, Node 24.22.3, npm 11.6.2. Bundled Node не имеет команды npm в PATH; использовался `node <локальный npm>/bin/npm-cli.js` — те же npm scripts и lockfiles. Чистая установка npm ci выполнена отдельно в обоих приложениях.

## Диагностика и результаты

| Компонент | Проверка | Исходный результат | После исправлений / причина ошибки |
|---|---|---|---|
| API | npm ci | PASS | Lockfile обновлён адресными совместимыми обновлениями; чистую установку итогового lockfile дополнительно проверяет CI |
| API | Prisma generate | PASS, 7.10.0 | PASS, 7.10.1 |
| API | npm run lint | PASS, 0 errors/warnings | PASS, 0 errors/warnings |
| API | npm run build | PASS | PASS |
| API | npm test | PASS, 2/2 | PASS, 2/2 |
| API | npm run test:e2e | BLOCKED до подключения к БД | Вызов Bash попадает в WSL без установленного дистрибутива; после переносимого runner PASS, 31/31, 7 файлов |
| API | npm run test:e2e:safety | Не было | PASS, 5/5, без БД |
| Web | npm ci | PASS на Windows | После первого CI восстановлены отсутствовавшие optional/peer записи; PASS в чистом Linux Node 24/npm 11.19.1 |
| Web | npm run lint | PASS, 0 errors/warnings | PASS, 0 errors/warnings |
| Web | npm run build | PASS, Next 16.3.6 | PASS, Next 16.4.6, включая TypeScript |
| API | production npm audit | FAIL: 16 записей, 10 high / 6 moderate | FAIL: 3 high одной цепочки Prisma/Effect, #38 |
| Web | production npm audit | FAIL: 3 записи, 1 critical / 2 high | PASS: 0 |
| Git | repository hygiene | PASS прежних правил | Расширенные правила выявили 5 backups исходников; сняты с отслеживания, файлы сохранены локально; PASS |
| Git | diff --check | PASS | PASS |

API E2E запускались штатной командой `npm run test:e2e`, а не обходом runner. Использован отдельный созданный для задачи контейнер `core02-e2e`, PostgreSQL 17, БД `core02_e2e`, порт `127.0.0.1:55442`, только схема `e2e`. Все 14 миграций применились с нуля; повторный migrate deploy сообщил отсутствие неприменённых миграций. Рабочая база не использовалась. Пользовательские фото/вложения не удалялись.

## Исправления

- `apps/api/test/run-e2e.mjs` запускает локальные entry points Prisma/Vitest через текущий Node без shell, глобальных npx и скачивания пакетов. `run-e2e.sh` оставлен совместимой обёрткой.
- `e2e-env.mjs` читает dotenv как данные, требует явный DATABASE_URL в обоих файлах, проверяет PostgreSQL и единственную `schema=e2e`, сравнивает рабочую e2e-схему с учётом loopback-алиасов, порта по умолчанию и разных credentials. Проверка выполняется до migrate deploy. Старый runner тоже отклонял отсутствующее переопределение URL; обход этой защиты не заявляется.
- `.env` используется только для сравнения адресов. Дочерние `dotenv/config` направлены на `.env.test`, чтобы настройки интеграций из рабочего файла не подгружались. Окружение вызывающего процесса сохраняется: не запускайте тесты с реальными корпоративными переменными. Проверка схемы сама по себе не подтверждает назначение сервера.
- Добавлены 5 тестов защиты конфигурации и E2E реально подписанного истёкшего JWT: `/auth/me`, `/tasks`, `/tasks/items/registry` возвращают 401.
- CI запускает unit и E2E safety tests; PostgreSQL 17 и изолированная CI БД сохранены. PR ограничен main, push в main и ручной запуск сохранены. Установка по lockfile, Prisma generate, lint/build и E2E обязательны.
- Первый CI выявил неполный Web lockfile после обновления на Windows/npm 11.6: Linux/npm 11.19 отклонял npm ci из-за отсутствия @emnapi/core и runtime 1.11.3. Lockfile восстановлен через npm install --package-lock-only --ignore-scripts в чистом Linux-контейнере Node 24; затем там же прошли npm ci, lint и production build. Исходники монтировались только для чтения. Пакеты вручную в JSON не добавлялись.
- Filename guard дополнен приватными каталогами, backups, архивами, почтой и ключами. Пять старых source backups удалены только из индекса Git. Gitleaks 8.30.1 сканирует новые коммиты PR/push, вывод маскируется; historical audit не подменяется сканированием нового диапазона.
- Обновлены README, changelog и отдельная PlantUML-схема CI. Бизнес-логика и существующие схемы/миграции не менялись. Автогенерируемый Prisma Client не редактировался вручную.

## Зависимости и остаточный риск

Обновления выполнены адресно через npm update в пределах существующих semver-диапазонов: NestJS 12.1.0 → 12.6.0, Prisma/client 7.10.0 → 7.10.1, совместимые транзитивные зависимости; Next и eslint-config-next согласованы на 16.4.6, source-map-js обновлён до исправленной версии. Новые библиотеки не добавлялись. `npm audit fix --force` не применялся.

- Next: устранены в том числе [critical Image Optimization](https://github.com/advisories/GHSA-2464-fhr4-w9xw) и другие применимые advisory старой версии. Отдельные уязвимые функции (use cache, SVG optimization) могут не использоваться приложением, но production-зависимость обновлена целиком.
- API: Multer 2.5.0 устраняет [DoS при fileFilter/teardown](https://github.com/advisories/GHSA-q7qp-rjg7-q26m); обновлены Express/body-parser/qs, deepmerge-ts, fast-uri, mysql2 в разрешённых деревом версиях. Полный цикл фото повторно проверен.
- Остаётся Prisma 7.10.1 → @prisma/config 7.10.1 → effect **3.20.0** (точный upstream pin). [Effect ReDoS](https://github.com/advisories/GHSA-7589-6fvf-x4pw) исправлен в 3.22.1. В приложении не найден путь разбора недоверенного ввода через Schema.TemplateLiteral; это оценка применимости, а не доказательство отсутствия риска. Три audit-записи — одна зависимостная цепочка, а не три независимые уязвимости.
- Создан [Issue #38](https://github.com/HeiterX/Supply_Manager/issues/38): совместимый upstream fix либо отдельно обоснованный override. Предложенный npm откат Prisma до 6.12.0 и Prisma 8 RC не применялись. Audit API остаётся с exit 1, не скрывается. CI audit по существующей политике информационный.
- Dev audit не является критерием production audit: первоначальная полная установка сообщала также dev findings. Финальные числа выше относятся строго к `--omit=dev`.

## Регрессия UI и API

Browser plugin not available; использован существующий Playwright + Chrome, без установки новых зависимостей. Production frontend `http://localhost:3108`, тестовый API `http://localhost:3008/api/v1`; viewport 1365×900 и 390×844. Только синтетические пользователи/закупки/фото.

12 браузерных сценариев PASS: вход ADMIN с настоящей cookie; создание и открытие закупки; стабильность DOM текущего действия; добавление/изменение позиции; КП и сохранение полей; заказ → оплата → доставка → передача → закрытие; реестр с ограниченным числом запросов; игнорирование отложенного отменённого ответа; возврат к входу после удаления cookie; экран запрета EMPLOYEE; публичная заявка с blob preview/uploadToken; прямое credentialed-чтение фотографии. Production-прогон не доказывает поведение development StrictMode.

| Проверка браузера | Результат |
|---|---|
| URL/title/содержимое | PASS, Supply Manager, страницы непустые |
| Framework overlay / page errors | Отсутствуют, 0 ошибок JavaScript |
| Console | Только 3 ожидаемых HTTP 401 гостя/сброшенной сессии; иных ошибок/warnings нет |
| Screenshot / mobile overflow | Снимки просмотрены, overflow отсутствует |
| Взаимодействия | PASS, состояния проверены после действий |

API E2E подтверждают PROCUREMENT/ADMIN, EMPLOYEE 403, гость 401, подписанный истёкший JWT 401, публичную заявку, uploadToken/типы/лимиты/гонки фото, ограничения чтения и полный существующий набор закупок. Браузерная очистка cookie проверяет потерю сессии; реальное истечение JWT отдельно проверяет API E2E. Снимки/QA-скрипт и JSON результатов оставлены локально в `.audit-tools/core02`, в Git не включены.

## CI и воспроизведение

[PR #39](https://github.com/HeiterX/Supply_Manager/pull/39). Первый [CI run #9](https://github.com/HeiterX/Supply_Manager/actions/runs/45018642390): API npm ci/generate/lint/build, unit 2/2, safety 5/5, E2E 31/31 и Repository hygiene/Gitleaks PASS; Web npm ci FAIL из-за неполного lockfile. Audit подтвердил Web 0 и API 3 high. Исправленный lockfile проверен в чистом Linux; окончательный прогон смотрите во вкладке [PR Checks](https://github.com/HeiterX/Supply_Manager/pull/39/checks). Локальные результаты не подменяют GitHub Actions. #23 остаётся открытым до ревью и приёмки; merge не выполняется.

```bash
node scripts/check-tracked-paths.mjs
cd apps/api
npm ci
npx prisma generate
npm run lint
npm run build
npm test
npm run test:e2e:safety
# Только локальные .env и .env.test, отдельный PostgreSQL 17/schema=e2e.
npm run test:e2e
npm audit --omit=dev --audit-level=high
cd ../web
npm ci
npm run lint
npm run build
npm audit --omit=dev --audit-level=high
```

Для Prisma generate на чистом checkout без env задайте фиктивный локальный DATABASE_URL; generate не требует подключения. Для E2E следуйте актуальному README; миграции выполняет runner после проверки конфигурации. Для браузерного QA при нестандартном порте API задайте NEXT_PUBLIC_API_URL **перед сборкой**, FRONTEND_ORIGIN и PORT для API. После проверки остановите только созданные тестовые процессы/контейнер.

Неустранённые предупреждения: vite-tsconfig-paths рекомендует native Vite resolution; pg предупреждает о конкурентных client.query внутри транзакции и будущей pg 9. Они существовали до изменений и не скрываются; переписывание транзакций выходит за стабилизацию без изменения бизнес-логики. Исторические риски SM-005, Firefox/Safari и промышленные настройки не подтверждаются этим отчётом. Следующему разработчику: ревью PR, повторный smoke test, затем отдельная работа #38; не закрывать #23 автоматически.
