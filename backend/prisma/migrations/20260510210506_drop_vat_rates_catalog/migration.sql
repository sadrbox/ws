-- ════════════════════════════════════════════════════════════════════════
-- Удаление справочника «Ставки НДС» (vat_rates).
-- Ставка НДС теперь хранится напрямую в настройках учёта организации
-- (organization_accounting_settings.vatRate / vatCalculationMethod) и
-- копируется в каждую строку sale_items при сохранении (sale_items.vatRate
-- остаётся, FK vatRateUuid удаляется).
-- ════════════════════════════════════════════════════════════════════════

-- 1. Добавить новые поля в настройки учёта (с дефолтами на случай отсутствия связи).
ALTER TABLE "organization_accounting_settings"
  ADD COLUMN IF NOT EXISTS "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS "vatCalculationMethod" TEXT NOT NULL DEFAULT 'INCLUDED';

-- 2. Перенести значения из vat_rates в новые поля (если справочник существует).
UPDATE "organization_accounting_settings" AS oas
SET
  "vatRate" = COALESCE(vr."rate", oas."vatRate"),
  "vatCalculationMethod" = COALESCE(vr."calculationMethod", oas."vatCalculationMethod")
FROM "vat_rates" AS vr
WHERE oas."vatRateUuid" = vr."uuid";

-- 3. Удалить FK + индекс + столбец vatRateUuid у настроек учёта.
ALTER TABLE "organization_accounting_settings"
  DROP CONSTRAINT IF EXISTS "organization_accounting_settings_vatRateUuid_fkey";
DROP INDEX IF EXISTS "organization_accounting_settings_vatRateUuid_idx";
ALTER TABLE "organization_accounting_settings"
  DROP COLUMN IF EXISTS "vatRateUuid";

-- 4. Удалить FK + индекс + столбец vatRateUuid у sale_items.
--    Числовое поле vatRate остаётся для исторической точности.
ALTER TABLE "sale_items"
  DROP CONSTRAINT IF EXISTS "sale_items_vatRateUuid_fkey";
DROP INDEX IF EXISTS "sale_items_vatRateUuid_idx";
ALTER TABLE "sale_items"
  DROP COLUMN IF EXISTS "vatRateUuid";

-- 5. Удалить таблицу справочника.
DROP TABLE IF EXISTS "vat_rates";
