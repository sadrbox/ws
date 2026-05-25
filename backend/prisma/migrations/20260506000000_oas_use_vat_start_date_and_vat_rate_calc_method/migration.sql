-- VatRate.calculationMethod
ALTER TABLE "vat_rates"
  ADD COLUMN "calculationMethod" TEXT NOT NULL DEFAULT 'INCLUDED';

-- OrganizationAccountingSetting: + startDate, + useVat, - taxUuids
ALTER TABLE "organization_accounting_settings"
  ADD COLUMN "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "useVat"    BOOLEAN      NOT NULL DEFAULT false;

-- Бэкфилл useVat по факту: если Ставка НДС, % задана — включаем учёт
UPDATE "organization_accounting_settings"
   SET "useVat" = true
 WHERE "vatRateUuid" IS NOT NULL;

ALTER TABLE "organization_accounting_settings"
  DROP COLUMN "taxUuids";

CREATE INDEX "organization_accounting_settings_startDate_idx"
  ON "organization_accounting_settings" ("startDate");
