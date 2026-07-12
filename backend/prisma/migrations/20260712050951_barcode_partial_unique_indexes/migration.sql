-- Частично-уникальные (partial unique) индексы штрихкодов.
--
-- ЗАЧЕМ: штрихкод уникален ТОЛЬКО среди активных записей — удалённая (soft-delete)
-- номенклатура не должна навсегда занимать свой штрихкод.
--
-- ПОЧЕМУ СЫРЫМ SQL: Prisma не умеет выражать условную уникальность в schema.prisma
-- (@@unique — безусловный, WHERE не поддерживается). Поэтому индексы объявлены здесь.
-- Следствие: `migrate diff --from-config-datasource` всегда будет показывать их как
-- «лишние» (DROP INDEX) — это ОЖИДАЕМЫЙ косметический дрейф, применять тот diff НЕЛЬЗЯ.
--
-- ПОЧЕМУ ЭТА МИГРАЦИЯ ПОЯВИЛАСЬ ПОЗДНО: индексы были созданы вручную прямо в рабочей
-- БД и ни в одну миграцию не попали. На ЧИСТОЙ базе (migrate deploy с нуля) их не было
-- бы вовсе — уникальность штрихкодов молча не действовала бы. IF NOT EXISTS делает
-- миграцию идемпотентной: на текущей БД это no-op, на новой — создаст.
CREATE UNIQUE INDEX IF NOT EXISTS "products_barcode_active_uq"
	ON "products" ("barcode")
	WHERE ("deletedAt" IS NULL AND "barcode" IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS "product_barcodes_barcode_active_uq"
	ON "product_barcodes" ("barcode")
	WHERE ("deletedAt" IS NULL);
