# CORE-09 — UI/API contract proposal

Статус на 22.11.2026: **предложение для согласования с Максимом, не существующий backend-контракт**. Issue [#30](https://github.com/HeiterX/Supply_Manager/issues/30). Проверены main `aa70d7f`, удалённые ветки и открытые PR: CORE-09 API/ветки не найдены. DTO, Prisma schema и контроллеры backend не изменены.

## Что существует

- `GET /api/v1/auth/me`, cookie-JWT, ADMIN/PROCUREMENT через AuthGate; EMPLOYEE не имеет доступа к закупкам.
- `GET /api/v1/tasks` возвращает доступные закупки с `nextAction: string|null`, `deadline`, `reminderAt`, статусом закупки и приоритетом.
- `GET /api/v1/tasks/:id` дополнительно возвращает `activities: {id,taskId,text,createdAt}[]`.
- `PATCH /api/v1/tasks/:id` принимает существующие priority/nextAction/reminderAt. Существующая форма не заменялась альтернативной бизнес-логикой.

У Task нет assignee, отдельного dueAt действия, серверной срочности, notification/readAt или типизированной истории действий. Deadline закупки и reminderAt **не подменяют** срок действия. В production UI нет fixtures и вычисления новых статусов из Date.now.

## Предлагаемые маршруты

Все URL ниже относительно `/api/v1`. Credentials include, no-store, JWT cookie и серверная фильтрация по текущему пользователю обязательны. Контракт локализован в `apps/web/lib/core09-api.ts` и компонентах CORE-09: при согласовании заменить адаптер, не создавать параллельные сущности/планировщики.

| Запрос | Ответ / назначение |
|---|---|
| `GET /next-actions?scope=mine&filter=all&q=&page=1&limit=20&sort=dueAt` | Персональные разрешённые активные действия, серверная сортировка по ближайшему сроку |
| `GET /next-actions/by-task/:taskId` | `{action: NextAction|null,timeZone}`; 200/null означает отсутствие действия, 404 пока трактуется как отсутствие endpoint |
| `GET /next-actions/:id/history` | `{items: ActionHistory[]}` в серверном порядке; договориться о пагинации для длинной истории |
| `PATCH /next-actions/:id` | Изменение разрешённых полей, только при `allowedOperations` с UPDATE; ответ обновлённое действие или 204 |
| `GET /notifications?filter=all&page=1&limit=20` | Персональная страница уведомлений и общий authoritative unreadCount |
| `PATCH /notifications/:id/read` | Идемпотентная серверная отметка прочитанного; ответ 204 или JSON |

Фильтры действий: `all`, `today`, `overdue`, `waiting_supplier`. Фильтры уведомлений: `all`, `unread`, `read`. Пагинация с 1. Сервер **обязан** применять RBAC/владение до поиска, пагинации, счётчиков и выдачи текстов. Подделанный taskId/id не даёт доступ. Нельзя возвращать чужие объекты для последующей фильтрации в браузере.

```typescript
type NextAction = {
  id: string;
  version: number;
  title: string;
  task: { id: string; number: number; title: string };
  assignee: { id: string; fullName: string } | null;
  dueAt: string | null;       // ISO 8601 с Z или offset
  reminderAt: string | null;  // отдельное назначение
  status: 'OVERDUE' | 'TODAY' | 'PLANNED' | 'WAITING_SUPPLIER' | 'COMPLETED' | 'CANCELLED';
  priority?: string;
  allowedOperations: ('UPDATE' | 'COMPLETE')[];
};
type ActionPage = {
  items: NextAction[];
  total: number; page: number; pageSize: number;
  counts: { all: number; today: number; overdue: number; waiting_supplier: number };
  timeZone: string; // IANA: например Europe/Moscow
};
type ActionHistory = {
  id: string; type: string; createdAt: string;
  actor: { fullName: string } | null;
  comment: string | null;
};
type Notice = {
  id: string; type: string; title: string; message: string | null;
  task: { id: string; number: number; title: string };
  createdAt: string; readAt: string | null;
};
type NoticePage = {
  items: Notice[]; unreadCount: number;
  total: number; page: number; pageSize: number;
};
```

Counts — весь разрешённый персональный активный scope до q/выбранного фильтра; total — после q и фильтра. unreadCount — весь персональный scope, не количество строк текущей страницы. Первенство срочности при ожидании поставщика, рабочие дни и границы «сегодня» определяет Максим; UI не реализует эти правила. Если утверждённый контракт разделяет lifecycle/urgency, адаптер и badges необходимо согласованно обновить.

Типы уведомлений в UI: ACTION_DUE, ACTION_OVERDUE, ASSIGNEE_CHANGED, DUE_DATE_CHANGED, ACTION_CREATED, ACTION_COMPLETED, ATTENTION_REQUIRED. Неизвестный тип отображается нейтрально как «Уведомление». Типы истории: CREATED, ASSIGNED, RESCHEDULED, UPDATED, COMPLETED, CANCELLED; actor=null означает системное событие. Завершение показывается в истории; новая операция COMPLETE не отправляется UI до отдельного согласования. Выполнение существующих операций закупки остаётся в старых кнопках карточки.

## Изменение действия

Тело PATCH: `{title,dueAt,reminderAt}`, null явно снимает дату. Заголовки `If-Match: "<version>"`, `Idempotency-Key: <UUID>`. Сервер атомарно проверяет версию, роль, разрешённую операцию и ограничения статуса; создаёт надёжную историю и инвалидирует старое напоминание. При конфликте 409 UI закрывает старую форму и перезагружает действие. Назначение ответственного требует дополнительного согласованного lookup/API и в UI не изменяется.

Ввод дат — локальное время устройства с явной IANA-подписью; отправка ISO UTC. Отображение dueAt/reminderAt действия использует серверный timeZone. События уведомлений/истории — время устройства. Валидация UI проверяет непустое название до 500 символов и валидность дат; рабочие часы, DST/допустимые интервалы, перенос и дедупликация планировщика — серверные проверки.

## Ошибки и переходный режим

401 → существующее событие AuthGate и вход; 403 → скрытие защищённого содержимого; 404 → «ожидаем подключение сервиса», без бесконечного polling; 409 → конфликт и обновление; 400/422 → ошибка формы; 5xx/сеть → безопасное сообщение и retry. Тело ошибки сервера не выводится. Ошибка/отсутствие счётчика показывается как неизвестное состояние, а не фиктивный 0.

При отсутствии новых маршрутов actions читает настоящий GET /tasks и явно показывает «Действия по доступным закупкам», **не выдавая их за персональные**. Фильтры срочности и счётчики недоступны. Карточка показывает настоящий nextAction/reminderAt и ссылку на общую историю. Notifications не генерируются из задач на клиенте.

## Обновления и что согласовать

Push API/SSE/WebSocket не найдены. Один feed провайдера отвечает за badge/панель и полный список all/page=1. Следующий запрос через 60 секунд **после завершения** предыдущего; скрытая вкладка не обновляется, при возврате делается refresh. Общий AbortController отменяется при смене ресурса, следующем запросе и размонтировании; timeout 15 секунд. GET 401/403/404 останавливает polling. Прочтение хранится на сервере; после PATCH обе проекции обновляются из API. По id удаляются дубликаты ответа, чтение optimistic не подменяется локальным счётчиком.

До приёмки backend: утвердить маршруты/DTO/версии и null-семантику, границы рабочего дня/timeZone, модель срочности/ожидания, RBAC/ownership и counts, lookup ответственных, retention/пагинацию истории, серверное расписание и дедупликацию событий. Затем повторить тесты с реальным CORE-09 API и проверить синхронизацию чтения между устройствами. Сейчас эти гарантии проверены только для предложенного контракта на fixtures, реальная интеграция CORE-09 **не завершена**.
