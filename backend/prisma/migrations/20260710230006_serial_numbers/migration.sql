-- AlterTable
ALTER TABLE "products" ADD COLUMN     "trackSerialNumbers" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "serial_numbers" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_stock',
    "productUuid" TEXT NOT NULL,
    "warehouseUuid" TEXT,
    "organizationUuid" TEXT,
    "receiptDocType" TEXT,
    "receiptDocUuid" TEXT,
    "issueDocType" TEXT,
    "issueDocUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "serial_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "serial_numbers_uuid_key" ON "serial_numbers"("uuid");

-- CreateIndex
CREATE INDEX "serial_numbers_productUuid_idx" ON "serial_numbers"("productUuid");

-- CreateIndex
CREATE INDEX "serial_numbers_status_idx" ON "serial_numbers"("status");

-- CreateIndex
CREATE INDEX "serial_numbers_warehouseUuid_idx" ON "serial_numbers"("warehouseUuid");

-- CreateIndex
CREATE INDEX "serial_numbers_organizationUuid_idx" ON "serial_numbers"("organizationUuid");

-- CreateIndex
CREATE INDEX "serial_numbers_receiptDocUuid_idx" ON "serial_numbers"("receiptDocUuid");

-- CreateIndex
CREATE INDEX "serial_numbers_issueDocUuid_idx" ON "serial_numbers"("issueDocUuid");

-- CreateIndex
CREATE UNIQUE INDEX "serial_numbers_organizationUuid_productUuid_serialNumber_key" ON "serial_numbers"("organizationUuid", "productUuid", "serialNumber");

-- AddForeignKey
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

