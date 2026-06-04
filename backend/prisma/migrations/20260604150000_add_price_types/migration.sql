
-- CreateTable
CREATE TABLE "price_types" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "organizationUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "price_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_prices" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "productUuid" TEXT NOT NULL,
    "priceTypeUuid" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "price" DECIMAL(18,2),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "product_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "price_types_uuid_key" ON "price_types"("uuid");

-- CreateIndex
CREATE INDEX "price_types_organizationUuid_idx" ON "price_types"("organizationUuid");

-- CreateIndex
CREATE UNIQUE INDEX "product_prices_uuid_key" ON "product_prices"("uuid");

-- CreateIndex
CREATE INDEX "product_prices_productUuid_idx" ON "product_prices"("productUuid");

-- CreateIndex
CREATE INDEX "product_prices_priceTypeUuid_idx" ON "product_prices"("priceTypeUuid");

-- CreateIndex
CREATE INDEX "product_prices_date_idx" ON "product_prices"("date");

-- AddForeignKey
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_priceTypeUuid_fkey" FOREIGN KEY ("priceTypeUuid") REFERENCES "price_types"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

