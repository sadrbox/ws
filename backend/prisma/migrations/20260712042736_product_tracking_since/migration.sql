-- AlterTable: момент включения учёта по сериям/партиям.
ALTER TABLE "products" ADD COLUMN     "serialTrackingSince" TIMESTAMP(3),
ADD COLUMN     "batchTrackingSince" TIMESTAMP(3);

-- Бэкфилл: у товаров, где учёт УЖЕ включён, отметка = момент миграции.
-- Смысл: контроль серий/партий НЕ применяется задним числом. Все существующие
-- документы (их дата < отметки) остаются валидными и продолжают сохраняться —
-- до этого включение флага на товаре с историей ломало их сохранение (422:
-- «количество 150, серий 1»). Контроль начнёт действовать с новых документов.
UPDATE "products" SET "serialTrackingSince" = NOW() WHERE "trackSerialNumbers" = true;
UPDATE "products" SET "batchTrackingSince"  = NOW() WHERE "trackBatches" = true;
