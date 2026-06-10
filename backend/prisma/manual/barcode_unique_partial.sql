-- Защита уникальности штрих-кодов на уровне БД (defense-in-depth к app-проверке
-- findBarcodeOwner): закрывает гонку конкурентных вставок и прямые записи в БД.
--
-- ВАЖНО: это ЧАСТИЧНЫЕ (partial) unique-индексы — Prisma их в schema.prisma не
-- моделирует, поэтому держим их ВНЕ migrations (иначе дрейф схемы). Применять
-- вручную и фиксировать факт применения в своём процессе.
--
-- Частичные (WHERE deletedAt IS NULL), потому что:
--   • Product — soft-delete (удалённые строки не должны блокировать повторное
--     использование штрих-кода);
--   • ProductBarcode сейчас hard-delete, но поле deletedAt есть — на будущее.
--
-- Перед применением убедиться, что активных дублей нет (скрипт проверки выдал 0/0).
-- Полную кросс-табличную уникальность (Product.barcode == чужой ProductBarcode.barcode)
-- одним индексом не выразить — её по-прежнему держит app-проверка findBarcodeOwner.

CREATE UNIQUE INDEX IF NOT EXISTS "product_barcodes_barcode_active_uq"
  ON "product_barcodes" ("barcode")
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "products_barcode_active_uq"
  ON "products" ("barcode")
  WHERE "deletedAt" IS NULL AND "barcode" IS NOT NULL;
