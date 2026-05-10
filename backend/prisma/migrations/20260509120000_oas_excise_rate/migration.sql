-- Default excise rate for OrganizationAccountingSetting
ALTER TABLE "organization_accounting_settings"
  ADD COLUMN "exciseRate" DECIMAL(8, 4) NOT NULL DEFAULT 0;
