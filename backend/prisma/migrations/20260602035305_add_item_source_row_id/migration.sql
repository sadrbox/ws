-- DropIndex
-- Подчистка дрейфа БД: устаревший уникальный индекс на global_code, которого
-- нет в схеме (актуальная уникальность — @@unique([organizationUuid, code])).
-- IF EXISTS — на свежих БД этого индекса нет, иначе migrate deploy упадёт.
DROP INDEX IF EXISTS "chart_of_accounts_global_code_key";

-- AlterTable
ALTER TABLE "commercial_offer_items" ADD COLUMN     "sourceRowId" TEXT;

-- AlterTable
ALTER TABLE "outgoing_invoice_items" ADD COLUMN     "sourceRowId" TEXT;

-- AlterTable
ALTER TABLE "purchase_items" ADD COLUMN     "sourceRowId" TEXT;

-- AlterTable
ALTER TABLE "purchase_order_items" ADD COLUMN     "sourceRowId" TEXT;

-- AlterTable
ALTER TABLE "purchase_requisition_items" ADD COLUMN     "sourceRowId" TEXT;

-- AlterTable
ALTER TABLE "purchase_return_items" ADD COLUMN     "sourceRowId" TEXT;

-- AlterTable
ALTER TABLE "reservation_items" ADD COLUMN     "sourceRowId" TEXT;

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "sourceRowId" TEXT;

-- AlterTable
ALTER TABLE "sale_return_items" ADD COLUMN     "sourceRowId" TEXT;

-- AlterTable
ALTER TABLE "sales_order_items" ADD COLUMN     "sourceRowId" TEXT;

-- CreateIndex
CREATE INDEX "commercial_offer_items_sourceRowId_idx" ON "commercial_offer_items"("sourceRowId");

-- CreateIndex
CREATE INDEX "outgoing_invoice_items_sourceRowId_idx" ON "outgoing_invoice_items"("sourceRowId");

-- CreateIndex
CREATE INDEX "purchase_items_sourceRowId_idx" ON "purchase_items"("sourceRowId");

-- CreateIndex
CREATE INDEX "purchase_order_items_sourceRowId_idx" ON "purchase_order_items"("sourceRowId");

-- CreateIndex
CREATE INDEX "purchase_requisition_items_sourceRowId_idx" ON "purchase_requisition_items"("sourceRowId");

-- CreateIndex
CREATE INDEX "purchase_return_items_sourceRowId_idx" ON "purchase_return_items"("sourceRowId");

-- CreateIndex
CREATE INDEX "reservation_items_sourceRowId_idx" ON "reservation_items"("sourceRowId");

-- CreateIndex
CREATE INDEX "sale_items_sourceRowId_idx" ON "sale_items"("sourceRowId");

-- CreateIndex
CREATE INDEX "sale_return_items_sourceRowId_idx" ON "sale_return_items"("sourceRowId");

-- CreateIndex
CREATE INDEX "sales_order_items_sourceRowId_idx" ON "sales_order_items"("sourceRowId");
