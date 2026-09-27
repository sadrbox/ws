-- Аудит 26.09, исполнитель «backend-платформа»: индексы под горячие запросы.
--
-- Сгенерировано как diff схема↔схема (HEAD → новая schema.prisma), а не с базы: полный diff с базы
-- сносит частичные индексы уникальности штрихкодов (памятка reference_schema_drift_migrations).
-- Все индексы объявлены в schema.prisma (trgm — через ops: raw("gin_trgm_ops")), поэтому дрейфа
-- `check:drift` не дают. IF NOT EXISTS — миграция идемпотентна: повторный прогон или индекс,
-- уже созданный руками на живой базе, её не роняют.
--
-- Без CONCURRENTLY: миграция Prisma выполняется одним скриптом в транзакции. На момент аудита база
-- небольшая (десятки МБ) — блокировка записи в таблицы на время построения измеряется секундами.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Н6: SLA-джоб стандарта качества (services/quality/jobs.js) отбирает задачи по срокам.
CREATE INDEX IF NOT EXISTS "todos_deadline_idx" ON "todos"("deadline");
CREATE INDEX IF NOT EXISTS "todos_reactionDueAt_idx" ON "todos"("reactionDueAt");
CREATE INDEX IF NOT EXISTS "todos_nextControlAt_idx" ON "todos"("nextControlAt");
CREATE INDEX IF NOT EXISTS "todos_lastActivityAt_idx" ON "todos"("lastActivityAt");

-- Раздел 5: список по умолчанию — WHERE "organizationUuid" = ? ORDER BY id DESC LIMIT 500. Составной
-- индекс отдаёт первую страницу обратным проходом, без сортировки всех документов организации
-- (у sales, purchases, cash_orders, bank_statements он есть с миграции e3_composite_indexes).
-- Малообъёмные документы (закрытие месяца, приёмка ОС, инвентаризация, ГТД, зарплата) не включены.
CREATE INDEX IF NOT EXISTS "outgoing_invoices_organizationUuid_id_idx" ON "outgoing_invoices"("organizationUuid", "id");
CREATE INDEX IF NOT EXISTS "incoming_invoices_organizationUuid_id_idx" ON "incoming_invoices"("organizationUuid", "id");
CREATE INDEX IF NOT EXISTS "payment_invoices_organizationUuid_id_idx" ON "payment_invoices"("organizationUuid", "id");
CREATE INDEX IF NOT EXISTS "inventory_transfers_organizationUuid_id_idx" ON "inventory_transfers"("organizationUuid", "id");
CREATE INDEX IF NOT EXISTS "sale_returns_organizationUuid_id_idx" ON "sale_returns"("organizationUuid", "id");
CREATE INDEX IF NOT EXISTS "purchase_returns_organizationUuid_id_idx" ON "purchase_returns"("organizationUuid", "id");
CREATE INDEX IF NOT EXISTS "commercial_offers_organizationUuid_id_idx" ON "commercial_offers"("organizationUuid", "id");
CREATE INDEX IF NOT EXISTS "sales_orders_organizationUuid_id_idx" ON "sales_orders"("organizationUuid", "id");
CREATE INDEX IF NOT EXISTS "purchase_orders_organizationUuid_id_idx" ON "purchase_orders"("organizationUuid", "id");
CREATE INDEX IF NOT EXISTS "write_offs_organizationUuid_id_idx" ON "write_offs"("organizationUuid", "id");
CREATE INDEX IF NOT EXISTS "goods_receipts_organizationUuid_id_idx" ON "goods_receipts"("organizationUuid", "id");
CREATE INDEX IF NOT EXISTS "todos_organizationUuid_id_idx" ON "todos"("organizationUuid", "id");
CREATE INDEX IF NOT EXISTS "activity_history_organizationUuid_id_idx" ON "activity_history"("organizationUuid", "id");

-- Раздел 5: поиск ILIKE '%…%' (Prisma contains + insensitive). B-tree его не ускоряет; GIN pg_trgm —
-- да, но только если индексирована КАЖДАЯ колонка в OR поиска (иначе Postgres всё равно читает
-- таблицу целиком). Поэтому набор колонок — ровно тот, по которому ищет роутер.
-- События 1С (pipe_activity) и журнал действий (activity_history) НЕ включены: там OR по 7–9
-- колонкам, а это самые пишущие таблицы — см. отчёт исполнителя.
CREATE INDEX IF NOT EXISTS "counterparties_bin_trgm" ON "counterparties" USING GIN ("bin" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "counterparties_name_trgm" ON "counterparties" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "counterparties_legalName_trgm" ON "counterparties" USING GIN ("legalName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "todos_name_trgm" ON "todos" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "todos_description_trgm" ON "todos" USING GIN ("description" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "todos_result_trgm" ON "todos" USING GIN ("result" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "notes_body_trgm" ON "notes" USING GIN ("body" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "notes_authorName_trgm" ON "notes" USING GIN ("authorName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "contacts_value_trgm" ON "contacts" USING GIN ("value" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "contact_persons_fullName_trgm" ON "contact_persons" USING GIN ("fullName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "contact_persons_comment_trgm" ON "contact_persons" USING GIN ("comment" gin_trgm_ops);
