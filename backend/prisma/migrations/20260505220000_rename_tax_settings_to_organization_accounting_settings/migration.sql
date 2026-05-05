-- Rename tax_settings → organization_accounting_settings, add new columns

-- 1. Rename table
ALTER TABLE "tax_settings" RENAME TO "organization_accounting_settings";

-- 2. Rename indexes
ALTER INDEX "tax_settings_pkey" RENAME TO "organization_accounting_settings_pkey";
ALTER INDEX "tax_settings_uuid_key" RENAME TO "organization_accounting_settings_uuid_key";
ALTER INDEX "tax_settings_updatedAt_idx" RENAME TO "organization_accounting_settings_updatedAt_idx";
ALTER INDEX "tax_settings_organizationUuid_idx" RENAME TO "organization_accounting_settings_organizationUuid_idx";

-- 3. Rename FK constraint
ALTER TABLE "organization_accounting_settings"
  RENAME CONSTRAINT "tax_settings_organizationUuid_fkey"
  TO "organization_accounting_settings_organizationUuid_fkey";

-- 4. Add new columns: vatRateUuid (FK to vat_rates), useDiscount (Boolean default false)
ALTER TABLE "organization_accounting_settings"
  ADD COLUMN "vatRateUuid" TEXT,
  ADD COLUMN "useDiscount" BOOLEAN NOT NULL DEFAULT false;

-- 5. Add FK for vatRateUuid
ALTER TABLE "organization_accounting_settings"
  ADD CONSTRAINT "organization_accounting_settings_vatRateUuid_fkey"
  FOREIGN KEY ("vatRateUuid") REFERENCES "vat_rates"("uuid")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 6. Index on vatRateUuid
CREATE INDEX "organization_accounting_settings_vatRateUuid_idx"
  ON "organization_accounting_settings"("vatRateUuid");
