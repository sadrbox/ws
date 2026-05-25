-- AlterTable: add barcode field to products
ALTER TABLE "products" ADD COLUMN "barcode" TEXT;

-- CreateIndex
CREATE INDEX "products_barcode_idx" ON "products"("barcode");
