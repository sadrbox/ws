-- SaleItem: акциз (НК РК ст. 463) + Облагаемый оборот по НДС (графа 13 ЭСФ).
ALTER TABLE "sale_items"
  ADD COLUMN IF NOT EXISTS "amountWithoutVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "exciseRate" DECIMAL(8,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "exciseAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- Бекфилл "amountWithoutVat" по существующим записям: amount − vatAmount.
UPDATE "sale_items"
   SET "amountWithoutVat" = ROUND(("amount" - "vatAmount")::numeric, 2)
 WHERE "amountWithoutVat" = 0
   AND ("amount" <> 0 OR "vatAmount" <> 0);

-- OrganizationAccountingSetting: флаг использования акциза.
ALTER TABLE "organization_accounting_settings"
  ADD COLUMN IF NOT EXISTS "useExcise" BOOLEAN NOT NULL DEFAULT false;
