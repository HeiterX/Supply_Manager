# Журнал изменений

## CORE-09 UI — 22.11.2026

- Страницы действий/уведомлений, колокольчик и общий unread feed; типизированный клиент, отмена запросов, safe polling и обработка auth errors.
- Блок Next Action в карточке, proposed permissions/version-aware edit и серверная история; текущие реальные task fields сохранены.
- Честное unavailable/fallback состояние при отсутствующем CORE-09 API; бизнес-правила backend не дублируются.
- Native unit и Playwright desktop/mobile tests в CI; контракт для Максима, описание архитектуры и PlantUML. Полная интеграция ожидает серверную часть #30.

## CORE-02 — 22.11.2026

- CI запускает unit-тесты API, тесты защиты E2E-конфигурации и Gitleaks новых коммитов; усилена проверка приватных путей.
- E2E запускается на Windows/Linux без Bash и npx; тестовый URL обязателен в `.env.test`, одинаковая рабочая схема отклоняется до миграций.
- Обновлены совместимые зависимости NestJS/Prisma и Next.js 16.4.6; production audit Web очищен, оставшаяся цепочка Prisma/Effect вынесена в #38.
- Восстановлены optional/peer записи frontend lockfile; чистые npm ci, lint и build проверены в Linux с npm 11.19.
- Добавлен E2E истёкшей JWT-сессии; старые backups исходников сняты с отслеживания без удаления локальных файлов.
- Обновлены инструкции, [отчёт CORE-02](docs/CORE-02-report.md) и [схема CI](docs/core02-ci.puml).
