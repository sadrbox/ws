-- CreateTable
CREATE TABLE "product_cost_snapshot" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "organizationUuid" TEXT NOT NULL,
    "productUuid" TEXT NOT NULL,
    "warehouseUuid" TEXT NOT NULL,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "layers" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_cost_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_cost_snapshot_uuid_key" ON "product_cost_snapshot"("uuid");

-- CreateIndex
CREATE INDEX "product_cost_snapshot_organizationUuid_asOfDate_idx" ON "product_cost_snapshot"("organizationUuid", "asOfDate");

-- CreateIndex
CREATE UNIQUE INDEX "product_cost_snapshot_organizationUuid_productUuid_warehous_key" ON "product_cost_snapshot"("organizationUuid", "productUuid", "warehouseUuid", "asOfDate");

