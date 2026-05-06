-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "isPrimary" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "isPrimary" BOOLEAN NOT NULL DEFAULT false;
