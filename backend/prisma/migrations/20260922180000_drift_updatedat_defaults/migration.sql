-- Выравнивание двух дефолтов `updatedAt` по schema.prisma (аудит согласованности 22.09).
--
-- ЗАЧЕМ. Проверка дрейфа (`npm run check:drift`) сравнивает фактическую схему со schema.prisma и должна
-- падать ТОЛЬКО на настоящем расхождении. Среди её вывода было два таких: у `notes` в базе не было
-- умолчания на `updatedAt`, а у `esf_licenses` оно, наоборот, было — хотя в схеме обе колонки описаны
-- одинаково (`@updatedAt`, без `@default`). Само значение пишет Prisma при каждой записи, поэтому правка
-- поведения не меняет; она убирает шум, из-за которого ворота дрейфа были красными всегда и настоящий
-- дрейф в них утонул бы.
--
-- Остальные расхождения из вывода — не дрейф: это имена ограничений, оставшиеся от переименования таблиц
-- (`user_settings` → `access_rights`, `user_access_rights` → `access_permissions`), и индексы, которые
-- Prisma не умеет выражать (trgm и partial unique). Они перечислены как ожидаемые в самом скрипте.
ALTER TABLE "notes" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "esf_licenses" ALTER COLUMN "updatedAt" DROP DEFAULT;
