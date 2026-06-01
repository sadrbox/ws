# ws — backend

Node.js + Express + Prisma (PostgreSQL).

## Запуск

```sh
npm install
npm run dev          # node server.js
npm test             # node --test (юнит/интеграционные тесты)
```

## Миграции Prisma

История миграций **сжата в единый baseline** `prisma/migrations/0_init` (полный
DDL текущей схемы + partial unique-индекс `chart_of_accounts_global_code_key`,
который Prisma не умеет выражать в `schema.prisma`).

### Новая / чистая БД (CI, новый разработчик)

Просто применяется baseline:

```sh
npx prisma migrate deploy
```

### ⚠️ Уже существующая БД (после `git pull` со squash-коммитом)

На БД, где раньше была применена старая история (60+ миграций), Prisma увидит
в `_prisma_migrations` записи, которых больше нет в папке, и `migrate status`
сломается. Нужен **разовый ребейзлайн** (схема БД при этом НЕ меняется):

```sh
# 1) очистить таблицу учёта миграций (в psql или любом SQL-клиенте к вашей БД):
DELETE FROM _prisma_migrations;

# 2) отметить baseline применённым (без выполнения SQL — схема уже на месте):
npx prisma migrate resolve --applied 0_init

# 3) проверить:
npx prisma migrate status      # → "Database schema is up to date!"
```

## Проверка дрейфа схемы

`schema.prisma` должна соответствовать фактической схеме БД. Проверка:

```sh
npm run check:drift
```

Падает (exit 1) при любом расхождении, **кроме** единственного ожидаемого —
partial-индекса `chart_of_accounts_global_code_key` (Prisma не выражает
WHERE-индексы; он живёт в миграции `0_init`). Рекомендуется как шаг CI.

> ВАЖНО: `prisma db push` для этого проекта **не использовать** — он удалит
> partial-индекс (потеря уникальности кода глобальных счетов) и может затронуть
> legacy-колонки. Изменения схемы вносить через миграции и `npm run check:drift`.

## Подсистемы

- `services/accountingPosting.js` — движок бухгалтерских проводок (правила
  `POSTING_RULES` по типам документов; идемпотентный reconcile по `posted`).
- `services/productRegister.js` — регистр движений ТМЗ и контроль остатков.
- `api/router/_documentHeaderFactory.js` / `_documentItemsFactory.js` — фабрики
  CRUD-роутеров шапки и позиций документов.
- `prisma/seed-testdata.js` — генератор связанного тестового набора данных.
