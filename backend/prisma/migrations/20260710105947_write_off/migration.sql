-- CreateTable
CREATE TABLE "write_offs" (
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

    CONSTRAINT "write_offs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "write_off_items" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unitOfMeasureUuid" TEXT,
    "productUuid" TEXT,
    "writeOffUuid" TEXT NOT NULL,
    "organizationUuid" TEXT,
    "sourceRowId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "write_off_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "write_offs_uuid_key" ON "write_offs"("uuid");

-- CreateIndex
CREATE INDEX "write_offs_organizationUuid_idx" ON "write_offs"("organizationUuid");

-- CreateIndex
CREATE INDEX "write_offs_warehouseUuid_idx" ON "write_offs"("warehouseUuid");

-- CreateIndex
CREATE INDEX "write_offs_date_idx" ON "write_offs"("date");

-- CreateIndex
CREATE INDEX "write_offs_updatedAt_idx" ON "write_offs"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "write_off_items_uuid_key" ON "write_off_items"("uuid");

-- CreateIndex
CREATE INDEX "write_off_items_writeOffUuid_idx" ON "write_off_items"("writeOffUuid");

-- CreateIndex
CREATE INDEX "write_off_items_productUuid_idx" ON "write_off_items"("productUuid");

-- CreateIndex
CREATE INDEX "write_off_items_sourceRowId_idx" ON "write_off_items"("sourceRowId");

-- AddForeignKey
ALTER TABLE "write_offs" ADD CONSTRAINT "write_offs_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "write_offs" ADD CONSTRAINT "write_offs_warehouseUuid_fkey" FOREIGN KEY ("warehouseUuid") REFERENCES "warehouses"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "write_offs" ADD CONSTRAINT "write_offs_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "write_off_items" ADD CONSTRAINT "write_off_items_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "write_off_items" ADD CONSTRAINT "write_off_items_writeOffUuid_fkey" FOREIGN KEY ("writeOffUuid") REFERENCES "write_offs"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "write_off_items" ADD CONSTRAINT "write_off_items_unitOfMeasureUuid_fkey" FOREIGN KEY ("unitOfMeasureUuid") REFERENCES "units_of_measure"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

