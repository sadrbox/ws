-- Подсистема бухгалтерского учёта РК: план счетов, виды субконто, проводки, аналитика.

-- ── Поле posted для документов, у которых его не было ────────────────────────
ALTER TABLE "cash_receipt_orders"   ADD COLUMN IF NOT EXISTS "posted" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "cash_expense_orders"   ADD COLUMN IF NOT EXISTS "posted" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "payroll_calculations"  ADD COLUMN IF NOT EXISTS "posted" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "payroll_payments"      ADD COLUMN IF NOT EXISTS "posted" BOOLEAN NOT NULL DEFAULT true;

-- ── Справочник «Виды субконто» ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "subkonto_types" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "referenceEndpoint" TEXT,
    "referenceModel" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "subkonto_types_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "subkonto_types_uuid_key" ON "subkonto_types"("uuid");
CREATE UNIQUE INDEX IF NOT EXISTS "subkonto_types_code_key" ON "subkonto_types"("code");
CREATE INDEX IF NOT EXISTS "subkonto_types_updatedAt_idx" ON "subkonto_types"("updatedAt");

-- ── План счетов ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "chart_of_accounts" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountType" TEXT NOT NULL DEFAULT 'active',
    "parentUuid" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isCurrency" BOOLEAN NOT NULL DEFAULT false,
    "isQuantitative" BOOLEAN NOT NULL DEFAULT false,
    "isOffBalance" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "subkonto1Type" TEXT,
    "subkonto2Type" TEXT,
    "subkonto3Type" TEXT,
    "organizationUuid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "chart_of_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "chart_of_accounts_uuid_key" ON "chart_of_accounts"("uuid");
CREATE UNIQUE INDEX IF NOT EXISTS "chart_of_accounts_organizationUuid_code_key" ON "chart_of_accounts"("organizationUuid", "code");
-- Уникальность кода для типовых (глобальных) счетов организации NULL.
CREATE UNIQUE INDEX IF NOT EXISTS "chart_of_accounts_global_code_key" ON "chart_of_accounts"("code") WHERE "organizationUuid" IS NULL AND "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "chart_of_accounts_code_idx" ON "chart_of_accounts"("code");
CREATE INDEX IF NOT EXISTS "chart_of_accounts_parentUuid_idx" ON "chart_of_accounts"("parentUuid");
CREATE INDEX IF NOT EXISTS "chart_of_accounts_organizationUuid_idx" ON "chart_of_accounts"("organizationUuid");
CREATE INDEX IF NOT EXISTS "chart_of_accounts_updatedAt_idx" ON "chart_of_accounts"("updatedAt");

DO $$ BEGIN
    ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_parentUuid_fkey" FOREIGN KEY ("parentUuid") REFERENCES "chart_of_accounts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── Бухгалтерские проводки ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "accounting_entries" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "organizationUuid" TEXT,
    "documentType" TEXT NOT NULL,
    "documentUuid" TEXT NOT NULL,
    "documentId" INTEGER,
    "date" TIMESTAMP(3) NOT NULL,
    "debitAccountUuid" TEXT,
    "debitAccountCode" TEXT NOT NULL,
    "creditAccountUuid" TEXT,
    "creditAccountCode" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "accounting_entries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "accounting_entries_uuid_key" ON "accounting_entries"("uuid");
CREATE INDEX IF NOT EXISTS "accounting_entries_organizationUuid_idx" ON "accounting_entries"("organizationUuid");
CREATE INDEX IF NOT EXISTS "accounting_entries_documentType_documentUuid_idx" ON "accounting_entries"("documentType", "documentUuid");
CREATE INDEX IF NOT EXISTS "accounting_entries_date_idx" ON "accounting_entries"("date");
CREATE INDEX IF NOT EXISTS "accounting_entries_debitAccountCode_idx" ON "accounting_entries"("debitAccountCode");
CREATE INDEX IF NOT EXISTS "accounting_entries_creditAccountCode_idx" ON "accounting_entries"("creditAccountCode");

DO $$ BEGIN
    ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── Аналитика проводок (субконто) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "accounting_entry_analytics" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "accountingEntryUuid" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "subkontoType" TEXT NOT NULL,
    "objectUuid" TEXT,
    "objectName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "accounting_entry_analytics_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "accounting_entry_analytics_uuid_key" ON "accounting_entry_analytics"("uuid");
CREATE INDEX IF NOT EXISTS "accounting_entry_analytics_accountingEntryUuid_idx" ON "accounting_entry_analytics"("accountingEntryUuid");
CREATE INDEX IF NOT EXISTS "accounting_entry_analytics_subkontoType_objectUuid_idx" ON "accounting_entry_analytics"("subkontoType", "objectUuid");

DO $$ BEGIN
    ALTER TABLE "accounting_entry_analytics" ADD CONSTRAINT "accounting_entry_analytics_accountingEntryUuid_fkey" FOREIGN KEY ("accountingEntryUuid") REFERENCES "accounting_entries"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
