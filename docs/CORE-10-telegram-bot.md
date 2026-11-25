# CORE-10 — Telegram-интеграция

Дата: 22.11.2026. Related to [#31](https://github.com/HeiterX/Supply_Manager/issues/31). Ветка `feature/core-10-telegram-bot`, worktree `.core10-telegram`. Исполнитель: raskodirovanii. Ревью/бизнес-приёмка: HeiterX. Issue остаётся открытым; автоматического merge нет.

## База и зависимости

Проверены актуальный main `aa70d7f`, remote branches, CORE-03 #24, CORE-09 #30 и открытые PR #39/#40. База — совместимый CORE-02 `bc02a1a` из #39 с исправлениями lint/CI. PR по запросу направляется в main и до merge #39 включает его три базовых коммита. Чужие ветки и основная рабочая копия со staged-удалениями сохранены.

Существующий AuthService перечитывает ACTIVE/role из БД; cookie-JWT и RolesGuard сохранены. Администрирование ролей/восстановление доступа CORE-03 не дублируется. CORE-09 backend отсутствует: #40 содержит frontend и предложенный контракт. В Task нет assignee, отдельного dueAt и версии действия. CORE-12/13 отдельные компоненты не реализованы: использованы текущие AuthGate, Tailwind и apiFetch.

## Архитектура

- `TelegramService`: grammY 1.46 Bot API client, timeout 15 секунд, безопасные коды ошибок вместо исключений с token URL/телами запросов. Polling удалён.
- `TelegramLinkService`: токены, двухстороннее подтверждение, отвязка, подписки и последние 10 результатов доставки текущего пользователя.
- `TelegramUpdatesService`: private commands/callbacks, существующие TasksService и PurchaseRequestsService. Webhook зарегистрирован в PurchaseRequestsModule, импортирующем TasksModule; циклической DI нет.
- `TelegramDeliveryService`: transactional outbox, маршрутизация, подписки и повторная проверка пользователя перед отправкой. Таймер доставляет готовые события; сроки/напоминания не вычисляет.
- Заявки и изменения закупок сохраняются вместе с outbox в одной бизнес-транзакции, без сетевых вызовов Telegram.

Модели: TelegramLink, TelegramSubscription, TelegramUpdateReceipt, TelegramRate, TelegramButton, TelegramDelivery. User.telegramChatId остаётся единственной unique-привязкой; добавлены telegramUsername и telegramMuted. Generated Prisma output обновлён согласно существующему отслеживанию файлов проекта. Схема взаимодействий — `core10-telegram.puml`; существующие roadmap PlantUML дополнены каналом и зависимостью CORE-09.

## Привязка

1. ACTIVE пользователь открывает `/settings/telegram`, создаёт ссылку авторизованным POST с точной проверкой Origin.
2. Генерируются 32 случайных байта (`crypto.randomBytes`), base64url 43 символа. В БД только SHA-256, TTL 5 минут. Новый токен отменяет предыдущий.
3. `/start TOKEN` принимается только при private chat и `from.id === chat.id`. Токен атомарно закрепляет одного кандидата; повтор/истечение отклоняются. Сырой токен не сохраняется в receipt, outbox или логах.
4. Владелец возвращается в веб, обновляет состояние и проверяет username **и числовой ID**. Только его cookie-сеанс может подтвердить pending link. Одного знания токена для подключения недостаточно.
5. UPDATE User блокирует строку и сериализует begin/claim/confirm/unlink; unique chat запрещает перенос к другому пользователю. Уже подключённый аккаунт требует отвязки.
6. Отмена/отключение удаляет pending tokens и кнопки, отменяет PENDING доставки. Повторное подключение требует нового токена.

Миграция `20261122130000_telegram_integration` **сбрасывает старые telegramChatId**, полученные прежней env-привязкой без доказательства владения. Пользователей нужно предупредить о повторном подключении перед rollout. Старые TELEGRAM_OPERATOR_USERNAME/TELEGRAM_CHAT_ID больше не восстанавливают связь. Данные закупок не удаляются, reset БД не нужен.

## Команды и роли

| Команда | EMPLOYEE | PROCUREMENT / ADMIN |
|---|---|---|
| /start, /menu | Свои заявки, настройки, помощь | Главное меню по роли |
| /tasks | Свои заявки через findMine | Первые 10 активных доступных закупок |
| /status НОМЕР | Отказ | Статус, Next Action, reminderAt, защищённая ссылка |
| /actions, /overdue | Отказ | Сообщение о недоступности персонального сервиса |
| /settings, /notifications | Настройки подключения | Настройки и подписки |
| /help | Разрешённые команды | Разрешённые команды |

Текущая веб-модель разрешает ADMIN/PROCUREMENT все закупки, и бот повторяет её. Отдельной объектной политики для этих ролей пока нет. EMPLOYEE по номеру/callback не читает закупки. Блокировка/смена роли проверяется на каждом запросе и перед доставкой. Новая политика CORE-03 должна расширить общий серверный сервис доступа, а не только UI бота.

## Уведомления

Автоматически реализованы:

- Внутренняя/публичная заявка: номер, статус, ссылка `/requests`. Без ФИО, описаний, фотографий и файлов.
- Закупка: существующий update статуса/приоритета/Next Action/reminderAt; выбор предложения; переходы одиночного заказа по оплате/доставке/получению/передаче/закрытию; обновление агрегированного состояния многопоставочного заказа и закрытие. Сообщение: номер, текущий статус, Next Action, ссылка на закупку.

Без модели назначений маршрутизацию явно задаёт администратор: `TELEGRAM_REQUEST_RECIPIENT_USERNAMES` и `TELEGRAM_PURCHASE_RECIPIENT_USERNAMES`. Пустой список — нет адресатов. Получатели должны быть ACTIVE ADMIN/PROCUREMENT, подключены, не muted, с включённой категорией. Нет общего chat ID или рассылки всем обладателям роли.

Подписки: NEW_REQUEST, ASSIGNED_ACTION, PURCHASE_CHANGED, DUE_SOON, OVERDUE. EMPLOYEE закупочные категории не получает; сервер запрещает их изменение. Назначения, приближение сроков, просрочки, изменение ответственного/срока и согласования ожидают реальных бизнес-событий CORE-09. Автоматическая отправка этих событий сейчас не заявляется.

## Контракт CORE-09

Producer определяет событие, момент, доступ и ответственного и вызывает канал **в своей транзакции**:

```ts
await telegramDelivery.publish(tx, {
  id: `core09:${persistedEvent.id}`, // неизменный при повторах producer
  category: 'DUE_SOON',
  recipientIds: authorizedResponsibleUserIds,
  text: minimalSafeSummary,
  path: `/tasks/${taskId}`,
});
```

Это внутренний NestJS контракт, не HTTP endpoint. CORE-09 обязан проверить доступ к конкретному объекту, передать разрешённых ответственных, выбрать событие/момент/повтор, исключить документы/секреты и при отмене действия отменить ещё не отправленные outbox по eventKey. Канал повторно проверяет ACTIVE/роль/привязку/подписку и unique eventKey+recipientKey. Изменение срока требует нового события/версии, а не случайного ID при каждом повторе. Требуется согласование с Максимом; реальная интеграция ожидает CORE-09.

## Callbacks и идемпотентность

Кнопка содержит случайный 128-битный opaque ID; command/userId/expiry/usedAt — на сервере, TTL 10 минут. Update receipt, callback receipt, расходование кнопки и outbox ответа фиксируются одной транзакцией. Unique updateId/callbackId и условный UPDATE usedAt защищают гонки. Чужая/устаревшая/использованная кнопка даёт понятное сообщение. Старый `accept_request:UUID` не исполняется.

Telegram не выполняет изменяющие бизнес-операции: принятие заявки, заказ, оплата, перенос/завершение действия доступны через защищённые веб-страницы. Повторное создание заказа кнопкой исключено; несогласованных действий нет. `/status` обрабатывает отсутствующий объект без раскрытия данных; ссылки требуют обычной веб-авторизации.

## Доставка и ошибки

- Unique eventKey+recipientKey дедуплицирует producer. HTTP webhook отвечает успешно только после commit receipt+outbox; ошибка БД допускает повтор Telegram.
- Несколько workers конкурируют через условный UPDATE PENDING→SENDING, lease 60 секунд. До 20 сообщений за проход, следующий через секунду после завершения предыдущего.
- SENT только после message_id. 429 учитывает Retry-After; 5xx — exponential backoff+jitter; максимум 5 попыток.
- 403 → FAILED и muted текущей привязки. После разблокировки бота — отключение/новая привязка. Постоянные ошибки → FAILED.
- Сетевой timeout/истёкший SENDING lease → UNKNOWN: сообщение могло быть принято Telegram до потери ответа. Автоповтора нет. Exactly-once Bot API не гарантирует. Оператор может после проверки вручную повторить отдельное событие с осознанным риском дубля; публичного retry endpoint нет.
- Перезапуск сохраняет PENDING. Логи: delivery ID и безопасный errorCode, без API description, token URL и команд.
- Лимиты: 20 private updates/мин/chat, 10 новых ссылок/мин/user. Worker раз в час очищает rate windows старше суток, expired links и старые expired buttons. Receipts/delivery dedup сохраняются; длительное хранение/архивирование требует политики с dedup tombstones.

## Окружение и запуск

См. `.env.example`; Telegram-настройки копируются в `apps/api/.env`. Реальные значения не коммитить. Username без @, webhook secret: 32–256 символов A-Z/a-z/0-9/_/-. Для ручной приёмки использовать отдельного тестового бота и синтетические данные.

```sh
cd apps/api
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
npm run start:dev
# Только явная команда оператора после настройки HTTPS endpoint:
node scripts/telegram-webhook.mjs
cd ../web
npm ci
npm run build
npm run start -- -p 3001
```

Нужны DATABASE_URL, JWT_SECRET (32+), FRONTEND_ORIGIN, TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_WEBHOOK_URL. Локально webhook требует HTTPS tunnel к `/api/v1/telegram/webhook`; frontend может быть `http://localhost:3001`. Без Bot Token worker выключен, остальное приложение работает. Во время тестов TelegramService заменён моками; реальные токены/сообщения не используются.

Production: HTTPS proxy, штатные trusted proxy/cookie/CORS настройки. Webhook без cookie auth, но обязательный `X-Telegram-Bot-Api-Secret-Token`; другие endpoints — cookie-JWT и точный Origin allowlist для mutations. Ограничить body/частоту webhook на reverse proxy. Не логировать body/header secret, /start payload или исходящие token URL. Не задавать NEXT_PUBLIC_BOT_TOKEN. HTTP production ссылки отключены. Старые версии с polling нельзя запускать одновременно; секрет проверяется независимо от IP/URL.

`scripts/telegram-webhook.mjs` проверяет HTTPS/secret, регистрирует message+callback_query и команды, сохраняет pending updates, проверяет getWebhookInfo. Не запускается автоматически; ошибки санитизированы. Основания: [Telegram setWebhook](https://core.telegram.org/bots/api#setwebhook), [grammY Bot API](https://grammy.dev/guide/api).

## Диагностика

1. `/settings/telegram`: configured, pending candidate/expiry, connected, muted, последние доставки. Чужой userId через API передать нельзя.
2. 401/403: проверить ACTIVE, роль, cookie, Origin/secret; не выводить секреты для сравнения.
3. PENDING: worker, availableAt, binding/subscription. FAILED 403: разблокировать и переподключить. FAILED 400: валидность чата/сообщения. 429: дождаться availableAt.
4. UNKNOWN: проверить реальный чат на тестовых данных, не повторять весь outbox и не превращать UNKNOWN в PENDING при рестарте.
5. Нет уведомлений: explicit allowlist, роль/статус/подписка. CORE-09 subscriptions сами не создают события — нужен producer.
6. Не удалять receipt/delivery rows для «очистки дублей»; SQL-диагностика выбирает ID/status/attempts/errorCode без содержимого и токенов.

## Проверки и ограничения

Node 24.22.3 / PostgreSQL 17, только отдельные тестовые БД:

| Проверка | Результат |
|---|---|
| API install / Prisma generate | PASS |
| Новая + 14 предыдущих migrations на чистой БД | PASS; migrate diff — no difference |
| API lint / build | PASS, повторены после всех transaction hooks |
| Unit | 8/8 PASS (6 Telegram) |
| E2E configuration safety | 5/5 PASS |
| API E2E | 48/48 PASS (17 Telegram, 31 существующих) |
| Web lint / production build | PASS |
| Chrome UI | 3 role flows PASS, 1440×1000 / 820×900 / 390×844, 0 page errors |
| Real Telegram / production webhook / бизнес-приёмка | НЕ ПРОВЕРЕНО |

Browser plugin not available; regular Playwright + установленный Chrome. Проверены title/URL, непустая страница, отсутствие overlay, реальный cookie login всех ролей, link, mocked Telegram update в реальный webhook, web confirm, persisted subscriptions, cancel/confirm unlink, safe 503/retry, logout и отсутствие horizontal overflow. Скриншоты просмотрены, материалы локально `.audit-tools` вне Git. После окончательной сборки проверка повторена для всех трёх ролей, 0 page errors.

Создан [PR #41](https://github.com/HeiterX/Supply_Manager/pull/41) в main; исполнитель raskodirovanii, ревью HeiterX запрошено. На implementation HEAD `f2d04e4` все 5 jobs [CI run #14](https://github.com/HeiterX/Supply_Manager/actions/runs/45052757805) SUCCESS: чистые Linux npm ci из обоих lockfiles, Prisma generate, API/Web lint/build, unit, E2E safety, 48 E2E на PostgreSQL 17 и repository hygiene/Gitleaks новых коммитов. Audit jobs информационные: их success не означает отсутствие известной API-уязвимости #38. Полный diff PR дополнительно проверен Gitleaks stdin с redaction — утечек нет. Последующий коммит фиксирует только эту проверенную документацию.

Негативные E2E: CSRF/auth, expiry/rotation/replay токена, private-only, занятый chat, чужая веб-сессия, simultaneous claim, unlink/relink, EMPLOYEE own-only, foreign/expired/legacy callbacks, concurrent update/callback/worker dedup, BLOCKED/role change, opt-out/routing/повтор producer, 429/5xx cap, 403 muted, NETWORK/lease UNKNOWN. Ранний расширенный прогон выявил глобальные count assertions, конфликтовавшие с параллельными E2E; проверки привязаны к своим объектам/сообщениям, тесты не отключались.

Унаследованные warnings: Vite paths и pg concurrent-query deprecation. Production API audit: прежние 3 high цепочки Prisma/Effect (#38), grammY её не расширяет. Production Web audit — 0. Чистая установка и CI фиксируются в PR отдельно.

CORE-09 scheduler/assignment/overdue и новые права CORE-03 ещё не готовы; полная приёмка CORE-10 до них невозможна. Нет Telegram mutations/документов, broadcast, paging команд сверх первых 10, рабочего календаря и независимого scheduler. Блокировка после финальной проверки не отзывает отправленный запрос Bot API; unlink не удаляет уже доставленные сообщения. Real Bot API, публичный HTTPS webhook, Safari/Firefox и бизнес-приёмка Максимом не проверены.
