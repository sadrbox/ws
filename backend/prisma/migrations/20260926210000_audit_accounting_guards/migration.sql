-- Аудит 26.09, учёт (У6, У8): страховки на уровне базы.
--
-- Сгенерировано как diff схема↔схема (schema.prisma после миграции 20260926200000_attached_files_organization
-- → новая), а не с базы: полный diff с базы сносит частичные индексы уникальности штрихкодов
-- (памятка reference_schema_drift_migrations). IF NOT EXISTS — миграция идемпотентна.

-- У8: снимок себестоимости и пересчёт читают все движения организации до даты в порядке
-- date, documentId, id (services/costSnapshot.js) — индекс отдаёт их без сортировки.
CREATE INDEX IF NOT EXISTS "product_register_organizationUuid_date_documentId_id_idx" ON "product_register"("organizationUuid", "date", "documentId", "id");

-- У6: второе ПРОВЕДЁННОЕ закрытие того же месяца организации. Код отказывает (409,
-- findOverlappingMonthClose), но два одновременных запроса проходят проверку оба — этот индекс
-- ловит гонку. Частичный (WHERE) индекс Prisma не выражает, поэтому он живёт только здесь и
-- внесён в ожидаемые в scripts/check-schema-drift.sh. Перед добавлением проверено: дублей в
-- рабочей базе нет.
CREATE UNIQUE INDEX IF NOT EXISTS "month_closes_posted_period_uq" ON "month_closes"("organizationUuid", "periodStart") WHERE "posted" AND "deletedAt" IS NULL;
