-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "number" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "amount" DECIMAL(18,2),
    "organizationUuid" TEXT,
    "warehouseUuid" TEXT,
    "authorUuid" TEXT NOT NULL,
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "basisDocumentType" TEXT,
    "basisDocumentUuid" TEXT,
    "basisDocumentLabel" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_items" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unitOfMeasureUuid" TEXT,
    "productUuid" TEXT,
    "goodsReceiptUuid" TEXT NOT NULL,
    "organizationUuid" TEXT,
    "sourceRowId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "goods_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_uuid_key" ON "goods_receipts"("uuid");

-- CreateIndex
CREATE INDEX "goods_receipts_organizationUuid_idx" ON "goods_receipts"("organizationUuid");

-- CreateIndex
CREATE INDEX "goods_receipts_warehouseUuid_idx" ON "goods_receipts"("warehouseUuid");

-- CreateIndex
CREATE INDEX "goods_receipts_date_idx" ON "goods_receipts"("date");

-- CreateIndex
CREATE INDEX "goods_receipts_updatedAt_idx" ON "goods_receipts"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_items_uuid_key" ON "goods_receipt_items"("uuid");

-- CreateIndex
CREATE INDEX "goods_receipt_items_goodsReceiptUuid_idx" ON "goods_receipt_items"("goodsReceiptUuid");

-- CreateIndex
CREATE INDEX "goods_receipt_items_productUuid_idx" ON "goods_receipt_items"("productUuid");

-- CreateIndex
CREATE INDEX "goods_receipt_items_sourceRowId_idx" ON "goods_receipt_items"("sourceRowId");

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_warehouseUuid_fkey" FOREIGN KEY ("warehouseUuid") REFERENCES "warehouses"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_goodsReceiptUuid_fkey" FOREIGN KEY ("goodsReceiptUuid") REFERENCES "goods_receipts"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_unitOfMeasureUuid_fkey" FOREIGN KEY ("unitOfMeasureUuid") REFERENCES "units_of_measure"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

