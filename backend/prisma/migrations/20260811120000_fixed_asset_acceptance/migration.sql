-- Документ «Принятие к учёту ОС» (запуск амортизации). Параметры амортизации
-- хранятся на документе; движок начисляет при закрытии месяца.
CREATE TABLE "fixed_asset_acceptances" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "number" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "organizationUuid" TEXT,
    "fixedAssetUuid" TEXT NOT NULL,
    "initialCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "liquidationValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "usefulLifeMonths" INTEGER,
    "depreciationMethod" TEXT NOT NULL DEFAULT 'linear',
    "depreciationStartDate" TIMESTAMP(3),
    "depreciationAccount" TEXT NOT NULL DEFAULT '7210',
    "accumulatedAccount" TEXT NOT NULL DEFAULT '2420',
    "posted" BOOLEAN NOT NULL DEFAULT true,
    "authorUuid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fixed_asset_acceptances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fixed_asset_acceptances_uuid_key" ON "fixed_asset_acceptances"("uuid");
CREATE INDEX "fixed_asset_acceptances_organizationUuid_idx" ON "fixed_asset_acceptances"("organizationUuid");
CREATE INDEX "fixed_asset_acceptances_fixedAssetUuid_idx" ON "fixed_asset_acceptances"("fixedAssetUuid");
CREATE INDEX "fixed_asset_acceptances_depreciationStartDate_idx" ON "fixed_asset_acceptances"("depreciationStartDate");
CREATE INDEX "fixed_asset_acceptances_date_idx" ON "fixed_asset_acceptances"("date");
CREATE INDEX "fixed_asset_acceptances_updatedAt_idx" ON "fixed_asset_acceptances"("updatedAt");

ALTER TABLE "fixed_asset_acceptances" ADD CONSTRAINT "fixed_asset_acceptances_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fixed_asset_acceptances" ADD CONSTRAINT "fixed_asset_acceptances_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fixed_asset_acceptances" ADD CONSTRAINT "fixed_asset_acceptances_fixedAssetUuid_fkey" FOREIGN KEY ("fixedAssetUuid") REFERENCES "fixed_assets"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;
