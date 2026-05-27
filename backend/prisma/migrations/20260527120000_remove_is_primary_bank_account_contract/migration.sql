-- Remove isPrimary from bank_accounts and contracts

ALTER TABLE "bank_accounts" DROP COLUMN IF EXISTS "is_primary";
ALTER TABLE "contracts" DROP COLUMN IF EXISTS "is_primary";
