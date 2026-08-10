-- Справочник «Основные средства» + табличная часть ОС документа Поступление (Purchase).

CREATE TABLE "fixed_assets" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inventoryNumber" TEXT,
    "note" TEXT,
    "organizationUuid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "fixed_assets_uuid_key" ON "fixed_assets"("uuid");
CREATE INDEX "fixed_assets_organizationUuid_idx" ON "fixed_assets"("organizationUuid");
CREATE INDEX "fixed_assets_updatedAt_idx" ON "fixed_assets"("updatedAt");

CREATE TABLE "purchase_fixed_asset_items" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "purchaseUuid" TEXT NOT NULL,
    "fixedAssetUuid" TEXT,
    "fixedAssetName" TEXT,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountWithoutVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sourceRowId" TEXT,
    "date" TIMESTAMP(3),
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "organizationUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "purchase_fixed_asset_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "purchase_fixed_asset_items_uuid_key" ON "purchase_fixed_asset_items"("uuid");
CREATE INDEX "purchase_fixed_asset_items_purchaseUuid_idx" ON "purchase_fixed_asset_items"("purchaseUuid");
CREATE INDEX "purchase_fixed_asset_items_fixedAssetUuid_idx" ON "purchase_fixed_asset_items"("fixedAssetUuid");
CREATE INDEX "purchase_fixed_asset_items_sourceRowId_idx" ON "purchase_fixed_asset_items"("sourceRowId");

-- Каскад по родителю-документу; ссылка на карточку ОС — SET NULL при удалении карточки.
ALTER TABLE "purchase_fixed_asset_items"
  ADD CONSTRAINT "pfa_items_purchase_fkey" FOREIGN KEY ("purchaseUuid") REFERENCES "purchases"("uuid") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "pfa_items_fixed_asset_fkey" FOREIGN KEY ("fixedAssetUuid") REFERENCES "fixed_assets"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
