
-- AlterTable
ALTER TABLE "products" ADD COLUMN     "purchasePrice" DECIMAL(18,2),
ADD COLUMN     "wholesalePrice" DECIMAL(18,2);

-- CreateTable
CREATE TABLE "product_price_settings" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "number" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "organizationUuid" TEXT,
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "authorUuid" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "product_price_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_price_setting_items" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "priceSettingUuid" TEXT NOT NULL,
    "productUuid" TEXT,
    "salePrice" DECIMAL(18,2),
    "purchasePrice" DECIMAL(18,2),
    "wholesalePrice" DECIMAL(18,2),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "product_price_setting_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_price_settings_uuid_key" ON "product_price_settings"("uuid");

-- CreateIndex
CREATE INDEX "product_price_settings_organizationUuid_idx" ON "product_price_settings"("organizationUuid");

-- CreateIndex
CREATE INDEX "product_price_settings_date_idx" ON "product_price_settings"("date");

-- CreateIndex
CREATE INDEX "product_price_settings_updatedAt_idx" ON "product_price_settings"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "product_price_setting_items_uuid_key" ON "product_price_setting_items"("uuid");

-- CreateIndex
CREATE INDEX "product_price_setting_items_priceSettingUuid_idx" ON "product_price_setting_items"("priceSettingUuid");

-- CreateIndex
CREATE INDEX "product_price_setting_items_productUuid_idx" ON "product_price_setting_items"("productUuid");

-- AddForeignKey
ALTER TABLE "product_price_settings" ADD CONSTRAINT "product_price_settings_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_price_settings" ADD CONSTRAINT "product_price_settings_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_price_setting_items" ADD CONSTRAINT "product_price_setting_items_priceSettingUuid_fkey" FOREIGN KEY ("priceSettingUuid") REFERENCES "product_price_settings"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_price_setting_items" ADD CONSTRAINT "product_price_setting_items_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

