-- T6.1 Stage 3: партия перемещаемого ТМЗ на строке перемещения.
-- Nullable-колонка + индекс (безопасно, ничего не дропает).
ALTER TABLE "inventory_transfer_items" ADD COLUMN "batchUuid" TEXT;
CREATE INDEX "inventory_transfer_items_batchUuid_idx" ON "inventory_transfer_items"("batchUuid");
