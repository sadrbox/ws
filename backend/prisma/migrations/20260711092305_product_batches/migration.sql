-- AlterTable
ALTER TABLE "product_register" ADD COLUMN     "batchUuid" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "trackBatches" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "product_batches" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "manufactureDate" TIMESTAMP(3),
    "productUuid" TEXT NOT NULL,
    "organizationUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "product_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_batches_uuid_key" ON "product_batches"("uuid");

-- CreateIndex
CREATE INDEX "product_batches_productUuid_idx" ON "product_batches"("productUuid");

-- CreateIndex
CREATE INDEX "product_batches_expiryDate_idx" ON "product_batches"("expiryDate");

-- CreateIndex
CREATE INDEX "product_batches_organizationUuid_idx" ON "product_batches"("organizationUuid");

-- CreateIndex
CREATE UNIQUE INDEX "product_batches_organizationUuid_productUuid_batchNumber_key" ON "product_batches"("organizationUuid", "productUuid", "batchNumber");

-- CreateIndex
CREATE INDEX "product_register_batchUuid_idx" ON "product_register"("batchUuid");

-- AddForeignKey
ALTER TABLE "product_batches" ADD CONSTRAINT "product_batches_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

