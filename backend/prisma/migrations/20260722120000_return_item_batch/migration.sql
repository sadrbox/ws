-- T6.1 возвраты: партия на строках возвратов (sale_return приход, purchase_return расход).
ALTER TABLE "sale_return_items" ADD COLUMN "batchUuid" TEXT;
ALTER TABLE "purchase_return_items" ADD COLUMN "batchUuid" TEXT;
CREATE INDEX "sale_return_items_batchUuid_idx" ON "sale_return_items"("batchUuid");
CREATE INDEX "purchase_return_items_batchUuid_idx" ON "purchase_return_items"("batchUuid");
