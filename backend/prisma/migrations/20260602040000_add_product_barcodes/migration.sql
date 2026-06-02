-- CreateTable
CREATE TABLE "product_barcodes" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "comment" TEXT,
    "productUuid" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "product_barcodes_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "product_barcodes_uuid_key" ON "product_barcodes"("uuid");
-- CreateIndex
CREATE INDEX "product_barcodes_productUuid_idx" ON "product_barcodes"("productUuid");
-- CreateIndex
CREATE INDEX "product_barcodes_barcode_idx" ON "product_barcodes"("barcode");
-- CreateIndex
CREATE INDEX "product_barcodes_updatedAt_idx" ON "product_barcodes"("updatedAt");
-- AddForeignKey
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
