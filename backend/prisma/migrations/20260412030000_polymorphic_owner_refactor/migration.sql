-- ============================================================================
-- Полиморфный рефакторинг: замена множественных FK на ownerType + ownerUuid
-- Затрагивает: contracts, contacts, contact_persons, bank_accounts
-- ============================================================================

-- ============================================================================
-- 1. CONTRACTS
-- ============================================================================

-- Добавляем новые столбцы
ALTER TABLE "contracts" ADD COLUMN "ownerType" TEXT;
ALTER TABLE "contracts" ADD COLUMN "ownerUuid" TEXT;

-- Переносим данные
UPDATE "contracts" SET "ownerType" = 'organization', "ownerUuid" = "organizationUuid" WHERE "organizationUuid" IS NOT NULL;
UPDATE "contracts" SET "ownerType" = 'counterparty', "ownerUuid" = "counterpartyUuid" WHERE "counterpartyUuid" IS NOT NULL AND "ownerType" IS NULL;

-- Удаляем FK-ограничения
ALTER TABLE "contracts" DROP CONSTRAINT IF EXISTS "contracts_organizationUuid_fkey";
ALTER TABLE "contracts" DROP CONSTRAINT IF EXISTS "contracts_counterpartyUuid_fkey";

-- Удаляем старые индексы
DROP INDEX IF EXISTS "contracts_organizationUuid_idx";
DROP INDEX IF EXISTS "contracts_counterpartyUuid_idx";

-- Удаляем старые столбцы
ALTER TABLE "contracts" DROP COLUMN IF EXISTS "organizationUuid";
ALTER TABLE "contracts" DROP COLUMN IF EXISTS "counterpartyUuid";
ALTER TABLE "contracts" DROP COLUMN IF EXISTS "ownerName";

-- Создаём новый индекс
CREATE INDEX "contracts_ownerType_ownerUuid_idx" ON "contracts"("ownerType", "ownerUuid");

-- ============================================================================
-- 2. CONTACTS
-- ============================================================================

-- Добавляем новые столбцы
ALTER TABLE "contacts" ADD COLUMN "ownerType" TEXT;
ALTER TABLE "contacts" ADD COLUMN "ownerUuid" TEXT;

-- Переносим данные (приоритет: organization > counterparty > contactPerson > employee > user)
UPDATE "contacts" SET "ownerType" = 'organization', "ownerUuid" = "organizationUuid" WHERE "organizationUuid" IS NOT NULL;
UPDATE "contacts" SET "ownerType" = 'counterparty', "ownerUuid" = "counterpartyUuid" WHERE "counterpartyUuid" IS NOT NULL AND "ownerType" IS NULL;
UPDATE "contacts" SET "ownerType" = 'contactPerson', "ownerUuid" = "contactPersonUuid" WHERE "contactPersonUuid" IS NOT NULL AND "ownerType" IS NULL;
UPDATE "contacts" SET "ownerType" = 'employee', "ownerUuid" = "employeeUuid" WHERE "employeeUuid" IS NOT NULL AND "ownerType" IS NULL;
UPDATE "contacts" SET "ownerType" = 'user', "ownerUuid" = "userUuid" WHERE "userUuid" IS NOT NULL AND "ownerType" IS NULL;

-- Удаляем FK-ограничения
ALTER TABLE "contacts" DROP CONSTRAINT IF EXISTS "contacts_organizationUuid_fkey";
ALTER TABLE "contacts" DROP CONSTRAINT IF EXISTS "contacts_counterpartyUuid_fkey";
ALTER TABLE "contacts" DROP CONSTRAINT IF EXISTS "contacts_contactPersonUuid_fkey";
ALTER TABLE "contacts" DROP CONSTRAINT IF EXISTS "contacts_employeeUuid_fkey";

-- Удаляем старые индексы
DROP INDEX IF EXISTS "contacts_organizationUuid_idx";
DROP INDEX IF EXISTS "contacts_counterpartyUuid_idx";
DROP INDEX IF EXISTS "contacts_contactPersonUuid_idx";
DROP INDEX IF EXISTS "contacts_employeeUuid_idx";
DROP INDEX IF EXISTS "contacts_userUuid_idx";

-- Удаляем старые столбцы
ALTER TABLE "contacts" DROP COLUMN IF EXISTS "organizationUuid";
ALTER TABLE "contacts" DROP COLUMN IF EXISTS "counterpartyUuid";
ALTER TABLE "contacts" DROP COLUMN IF EXISTS "contactPersonUuid";
ALTER TABLE "contacts" DROP COLUMN IF EXISTS "employeeUuid";
ALTER TABLE "contacts" DROP COLUMN IF EXISTS "userUuid";
ALTER TABLE "contacts" DROP COLUMN IF EXISTS "ownerName";

-- Создаём новый индекс
CREATE INDEX "contacts_ownerType_ownerUuid_idx" ON "contacts"("ownerType", "ownerUuid");

-- ============================================================================
-- 3. CONTACT_PERSONS
-- ============================================================================

-- Добавляем новые столбцы
ALTER TABLE "contact_persons" ADD COLUMN "ownerType" TEXT;
ALTER TABLE "contact_persons" ADD COLUMN "ownerUuid" TEXT;

-- Переносим данные
UPDATE "contact_persons" SET "ownerType" = 'organization', "ownerUuid" = "organizationUuid" WHERE "organizationUuid" IS NOT NULL;
UPDATE "contact_persons" SET "ownerType" = 'counterparty', "ownerUuid" = "counterpartyUuid" WHERE "counterpartyUuid" IS NOT NULL AND "ownerType" IS NULL;

-- Удаляем FK-ограничения
ALTER TABLE "contact_persons" DROP CONSTRAINT IF EXISTS "contact_persons_organizationUuid_fkey";
ALTER TABLE "contact_persons" DROP CONSTRAINT IF EXISTS "contact_persons_counterpartyUuid_fkey";

-- Удаляем старые индексы
DROP INDEX IF EXISTS "contact_persons_organizationUuid_idx";
DROP INDEX IF EXISTS "contact_persons_counterpartyUuid_idx";

-- Удаляем старые столбцы
ALTER TABLE "contact_persons" DROP COLUMN IF EXISTS "organizationUuid";
ALTER TABLE "contact_persons" DROP COLUMN IF EXISTS "counterpartyUuid";
ALTER TABLE "contact_persons" DROP COLUMN IF EXISTS "ownerName";

-- Создаём новый индекс
CREATE INDEX "contact_persons_ownerType_ownerUuid_idx" ON "contact_persons"("ownerType", "ownerUuid");

-- ============================================================================
-- 4. BANK_ACCOUNTS
-- ============================================================================

-- Добавляем новые столбцы
ALTER TABLE "bank_accounts" ADD COLUMN "ownerType" TEXT;
ALTER TABLE "bank_accounts" ADD COLUMN "ownerUuid" TEXT;

-- Переносим данные
UPDATE "bank_accounts" SET "ownerType" = 'organization', "ownerUuid" = "organizationUuid" WHERE "organizationUuid" IS NOT NULL;
UPDATE "bank_accounts" SET "ownerType" = 'counterparty', "ownerUuid" = "counterpartyUuid" WHERE "counterpartyUuid" IS NOT NULL AND "ownerType" IS NULL;

-- Удаляем FK-ограничения
ALTER TABLE "bank_accounts" DROP CONSTRAINT IF EXISTS "bank_accounts_organizationUuid_fkey";
ALTER TABLE "bank_accounts" DROP CONSTRAINT IF EXISTS "bank_accounts_counterpartyUuid_fkey";

-- Удаляем старые уникальные ограничения
DROP INDEX IF EXISTS "bank_accounts_organizationUuid_iban_key";
DROP INDEX IF EXISTS "bank_accounts_counterpartyUuid_iban_key";

-- Удаляем старые индексы
DROP INDEX IF EXISTS "bank_accounts_organizationUuid_idx";
DROP INDEX IF EXISTS "bank_accounts_counterpartyUuid_idx";

-- Удаляем старые столбцы
ALTER TABLE "bank_accounts" DROP COLUMN IF EXISTS "organizationUuid";
ALTER TABLE "bank_accounts" DROP COLUMN IF EXISTS "counterpartyUuid";

-- Создаём новый индекс
CREATE INDEX "bank_accounts_ownerType_ownerUuid_idx" ON "bank_accounts"("ownerType", "ownerUuid");
