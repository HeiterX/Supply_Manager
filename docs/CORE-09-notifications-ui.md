# CORE-09 — Notifications and Next Action UI (Тимофей)

Дата: 22.11.2026. Related to [#30](https://github.com/HeiterX/Supply_Manager/issues/30). Ветка `feature/core-09-notifications-ui`, worktree `.core09-ui`.

## Границы и порядок интеграции

Это frontend-часть. В проверенных main/remote-ветках нет backend CORE-09 и CORE-12/13 отдельной дизайн-системы. Использованы существующие AppShell, Tailwind, белые карточки, синие акценты и AuthGate. NestJS, Prisma schema/migrations, бизнес-правила, назначения, сроки и серверное расписание не менялись. Никакие Telegram/email сообщения не отправлялись.

База — проверенный CORE-02 `bc02a1a`, PR #39 пока не слит. PR CORE-09 направляется в `feature/core-02-ci-stabilization`, чтобы в diff были только новые UI-изменения. После merge #39 нужно сменить base CORE-09 на main без копирования коммитов и force push. CI временно принимает PR и в эту зависимую базу; после retarget временную ветку можно убрать из фильтра workflow. Issue #30 остаётся открытым для совместной приёмки с Максимом.

## Компоненты и архитектура

- `lib/core09-api.ts`: типизированный адаптер существующего apiFetch, безопасные ошибки/timeout, типы NextAction/Notice/history, форматирование дат. **Новые маршруты — предложение**, описаны в [контракте](CORE-09-ui-api-contract.md).
- `lib/use-core09-resource.ts`: отмена устаревших запросов, отказ от старых данных при смене ключа/ошибке, последовательное периодическое обновление видимой вкладки, остановка на 401/403/404.
- `NotificationProvider`: только внутри успешного AuthGate; ключ текущего пользователя, общий feed и authoritative unreadCount, серверное прочтение с защитой от двойного PATCH. Размонтирование отменяет запросы и очищает память при смене сеанса.
- `NotificationBell/NotificationList`: колокольчик, badge, адаптивная панель, переход к закупке, даты, read/unread, retry/empty/unavailable. Escape закрывает панель и возвращает фокус; Tab и клик вне закрывают её, исчезновение прочитанной кнопки не закрывает панель неожиданно.
- `/actions`: персональные действия, server filters/counts/sort/search/page в URL, карточки со статусом, исполнителем, приоритетом, сроком и напоминанием. Существующий `/` остаётся списком закупок; новая страница — рабочий список действий, не второй CRUD закупок.
- `/notifications`: полный список, read/unread/all и пагинация в URL. All/page=1 использует тот же feed, что badge/панель, без второго polling одинакового запроса.
- `TaskNextAction`: важная информация над вкладками существующей карточки, серверная история, редактирование только при allowedOperations.UPDATE. Старые кнопки бизнес-операций сохранены.
- `ActionCard/ActionBadge`, `Skeleton`, `ResourceError`, `NotConnected`: общие представления. Срочность обозначена и текстом, и цветом; формы имеют labels, элементы — focus-visible; адаптивность проверена на 1440, 820 и 390 px.

## Что работает с текущим настоящим API

Вход/сеанс/ADMIN/PROCUREMENT/EMPLOYEE и защищённые переходы; чтение реальных nextAction/reminderAt доступных закупок; отображение их в карточке и ссылка на существующую общую историю. При 404 новых маршрутов показано честное ожидание сервиса: нет фиктивных уведомлений, ложного нулевого badge, персонального scope, статусов просрочки или доступных фильтров срочности. Напоминание не выдаётся за срок действия. Кнопка обновления перезагружает и fallback список.

## Что готово к подключению, но ждёт Максима

Персональные действия, серверная срочность/счётчики, server-sorted сроки, уведомления семи типов, прочтение между устройствами, права на редактирование, типизированная история с actor/comments. Отдельный срок действия и ответственный не выводятся из полей закупки. Новый API ещё не согласован и не проверен против реального CORE-09 backend. Приёмку полного end-to-end и серверную защиту от чужих данных/гонок/повторных уведомлений **не заявляем**.

Форма UPDATE отправляет title/dueAt/reminderAt, If-Match/version и Idempotency-Key; проверяет ввод, блокирует одновременную отправку, сообщает об успехе, обновляет данные. 409 закрывает старую форму и запрашивает текущую версию. Смена ответственного, COMPLETE API и серверный scheduler не реализованы в альтернативном виде: их контракт должен предоставить Максим.

## Время, права и ошибки

Статусы и значения фильтров приходят с API. Клиент не вычисляет today/overdue/waiting_supplier и не определяет рабочие часы. Даты действий форматируются в серверном IANA timeZone; ввод и события — локальное время устройства, отправка ISO UTC. Согласование DST/рабочего календаря описано в контракте.

Все новые запросы используют cookie credentials include и существующие auth events. 401 возвращает вход, 403 скрывает защищённый UI; старые данные после ошибок не показываются. Тело ответа ошибки не выводится. Это не заменяет backend RBAC: сервер обязан фильтровать объекты и счётчики до выдачи. 404 останавливает polling, 409 обрабатывается как конфликт, сеть/5xx дают retry. Один новый запрос feed через 60 секунд после завершения предыдущего; background вкладка приостановлена. Чтение не хранится в localStorage.

## Проверки и воспроизведение

```bash
cd apps/web
npm ci
npm test
npm run lint
npm run build
npx playwright install chromium
npm run test:ui
```

Node 24. Новая runtime-библиотека не добавлялась; dev dependency @playwright/test 1.65.1 нужна для воспроизводимых UI-тестов. В CI устанавливается Chromium с системными зависимостями и запускается тот же test:ui после production build. Все browser test routes/fixtures находятся только в `test/browser`, не импортируются приложением, не требуют БД. На Windows с установленным Chrome можно задать `PLAYWRIGHT_CHANNEL=chrome`. Не пересобирайте `.next` во время работающего next start: остановите сервер перед новой сборкой.

| Проверка | Подтверждённый результат |
|---|---|
| Frontend npm ci | PASS Windows; итоговый lockfile восстановлен/проверен также в чистом Linux Node 24/npm 11.19 |
| Frontend lint | PASS, 0 errors/warnings |
| Frontend build | PASS, Next 16.4.6/TypeScript, маршруты actions/notifications |
| Native Node unit | 11/11 PASS, включая фильтры/scope/sort, auth events, 404/409/5xx, abort, read204, дедупликацию, часовые пояса и pagination |
| Playwright contract suite | PASS, 22/22 (11 сценариев × desktop/mobile), production build, 0 page errors; CI фиксируется в PR |
| Расширенный Chrome QA | 17/17 PASS, отдельные реальные auth/tasks и mock CORE-09 API, 1440×1000 / 820×844 / 390×844 |
| Чистая Linux проверка | npm ci/unit/lint/build PASS в отдельном контейнере, исходники read-only |
| Реальный CORE-09 backend | НЕ ПРОВЕРЕН — реализации нет |
| Политика назначения, scheduler, межустройственное read | Ожидают backend, fixtures не доказывают серверные гарантии |

Подтверждён [PR #40](https://github.com/HeiterX/Supply_Manager/pull/40), reviewer HeiterX запрошен. [GitHub Actions run #12](https://github.com/HeiterX/Supply_Manager/actions/runs/45022377623) для `1aca19b984c94a883d52e3c9c2ecaefae5a7c76d`: все 5 jobs SUCCESS. Чистые API/Web install, lint/build, API unit/E2E, Web unit 11/11, Chromium desktop/mobile 22/22 и Gitleaks прошли; audit API остаётся информационным с унаследованным #38, Web production audit — 0. Расширенный Chrome QA 17/17 повторён на production build, 0 page errors. Последующий коммит записывает этот результат в документ; актуальный статус доступен в PR Checks.

Локальный native Windows Playwright запускался с разрешением вне песочницы, поскольку ограниченный запуск задерживался при завершении дочернего webServer; финальная команда вернула exit 0, 22 passed. Один ранний параллельный прогон не успел дождаться hydration за стандартные 5 секунд; trace показывал начальный AuthGate без API-запросов/page errors. Для готовности UI установлен явный expect timeout 10 секунд, retries=0; финальные Windows/Linux прогоны прошли без повторов. Общая защита от JS page errors проверяется после каждого browser test.

Расширенный QA: гость/EMPLOYEE не монтируют защищённые feeds; ADMIN и PROCUREMENT входят через настоящий API; fallback текущих задач; cards/status/timeZone/counts; фильтры и поиск в URL; отмена задержанного ответа; отсутствие дублей; unread badge/read; bounded polling; link/history/form; двойная отправка; 409; отсутствие UPDATE без permissions; desktop/tablet/mobile; offline/500/403/401. Next Action/notifications endpoint responses в этом прогоне — **изолированные Playwright fixtures**, а auth/task routes — настоящий API с отдельным PostgreSQL 17/core02_e2e/schema=e2e. Browser plugin not available, применён существующий Chrome/Playwright.

Page title и URL верны, страницы не пусты, framework overlay отсутствует. 0 page errors; console содержит только ожидаемые HTTP 401/403/404/409/500 и ERR_FAILED негативных сценариев, не скрытые ошибки приложения. Скриншоты просмотрены, горизонтального overflow нет. Материалы QA локально `.audit-tools/core09`, не в Git. В dev виден штатный Next indicator; это не элемент продукта.

Ограничения: Node native tests выводят предупреждение MODULE_TYPELESS_PACKAGE_JSON; Playwright runtime может сообщать NO_COLOR/FORCE_COLOR, функциональные ошибки не маскируются. Firefox/Safari не проверены. Унаследованный риск Prisma/Effect из CORE-02 остаётся в #38, frontend production audit не расширялся runtime-зависимостями. Зелёные fixtures/CI не означают завершённую серверную интеграцию или приёмку CORE-09.
