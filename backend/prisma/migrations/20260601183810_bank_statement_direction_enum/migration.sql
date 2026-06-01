-- CreateEnum
CREATE TYPE "BankStatementDirection" AS ENUM ('bankStatementIn', 'bankStatementOut');

-- Перенос существующих значений (text 'in'/'out' → значения enum)
UPDATE "bank_statements" SET "direction" = 'bankStatementIn'  WHERE "direction" = 'in';
UPDATE "bank_statements" SET "direction" = 'bankStatementOut' WHERE "direction" = 'out';

-- AlterTable: text → enum
ALTER TABLE "bank_statements" ALTER COLUMN "direction" DROP DEFAULT;
ALTER TABLE "bank_statements" ALTER COLUMN "direction" TYPE "BankStatementDirection" USING "direction"::"BankStatementDirection";
ALTER TABLE "bank_statements" ALTER COLUMN "direction" SET DEFAULT 'bankStatementIn';
