-- CreateTable
CREATE TABLE "stock_counts" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "number" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "organizationUuid" TEXT,
    "warehouseUuid" TEXT,
    "authorUuid" TEXT NOT NULL,
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_items" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "accountingQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unitOfMeasureUuid" TEXT,
    "productUuid" TEXT,
    "stockCountUuid" TEXT NOT NULL,
    "organizationUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "stock_count_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_uuid_key" ON "stock_counts"("uuid");

-- CreateIndex
CREATE INDEX "stock_counts_organizationUuid_idx" ON "stock_counts"("organizationUuid");

-- CreateIndex
CREATE INDEX "stock_counts_warehouseUuid_idx" ON "stock_counts"("warehouseUuid");

-- CreateIndex
CREATE INDEX "stock_counts_date_idx" ON "stock_counts"("date");

-- CreateIndex
CREATE INDEX "stock_counts_updatedAt_idx" ON "stock_counts"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_items_uuid_key" ON "stock_count_items"("uuid");

-- CreateIndex
CREATE INDEX "stock_count_items_stockCountUuid_idx" ON "stock_count_items"("stockCountUuid");

-- CreateIndex
CREATE INDEX "stock_count_items_productUuid_idx" ON "stock_count_items"("productUuid");

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_warehouseUuid_fkey" FOREIGN KEY ("warehouseUuid") REFERENCES "warehouses"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_stockCountUuid_fkey" FOREIGN KEY ("stockCountUuid") REFERENCES "stock_counts"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_unitOfMeasureUuid_fkey" FOREIGN KEY ("unitOfMeasureUuid") REFERENCES "units_of_measure"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

