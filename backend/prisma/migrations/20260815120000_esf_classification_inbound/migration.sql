-- Трек A: вид актива на карточке номенклатуры (товар/материал/ОС).
ALTER TABLE "products" ADD COLUMN "assetKind" TEXT NOT NULL DEFAULT 'goods';

-- Трек A2: память классификации строк ЭСФ (поставщик+ТН ВЭД+наименование → вид+карточка).
CREATE TABLE "esf_line_mappings" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "supplierBin" TEXT NOT NULL,
    "tnvedCode" TEXT,
    "nameKey" TEXT NOT NULL,
    "assetKind" TEXT NOT NULL DEFAULT 'goods',
    "productUuid" TEXT,
    "fixedAssetUuid" TEXT,
    "organizationUuid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "esf_line_mappings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "esf_line_mappings_uuid_key" ON "esf_line_mappings"("uuid");
CREATE UNIQUE INDEX "esf_line_mappings_matchKey_key" ON "esf_line_mappings"("matchKey");
CREATE INDEX "esf_line_mappings_supplierBin_idx" ON "esf_line_mappings"("supplierBin");
CREATE INDEX "esf_line_mappings_organizationUuid_idx" ON "esf_line_mappings"("organizationUuid");

-- Трек B1: входящий ЭСФ (шапка).
CREATE TABLE "esf_inbounds" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "esfId" TEXT,
    "registrationNumber" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "supplierBin" TEXT,
    "supplierName" TEXT,
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'received',
    "processedPurchaseUuid" TEXT,
    "organizationUuid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "esf_inbounds_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "esf_inbounds_uuid_key" ON "esf_inbounds"("uuid");
CREATE INDEX "esf_inbounds_organizationUuid_idx" ON "esf_inbounds"("organizationUuid");
CREATE INDEX "esf_inbounds_supplierBin_idx" ON "esf_inbounds"("supplierBin");
CREATE INDEX "esf_inbounds_status_idx" ON "esf_inbounds"("status");
CREATE INDEX "esf_inbounds_updatedAt_idx" ON "esf_inbounds"("updatedAt");

-- Трек B1: строки входящего ЭСФ.
CREATE TABLE "esf_inbound_lines" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "inboundUuid" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "tnvedCode" TEXT,
    "catalogTruId" TEXT,
    "unitCode" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountWithoutVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "assetKind" TEXT NOT NULL DEFAULT 'goods',
    CONSTRAINT "esf_inbound_lines_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "esf_inbound_lines_uuid_key" ON "esf_inbound_lines"("uuid");
CREATE INDEX "esf_inbound_lines_inboundUuid_idx" ON "esf_inbound_lines"("inboundUuid");
ALTER TABLE "esf_inbound_lines" ADD CONSTRAINT "esf_inbound_lines_inboundUuid_fkey" FOREIGN KEY ("inboundUuid") REFERENCES "esf_inbounds"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
