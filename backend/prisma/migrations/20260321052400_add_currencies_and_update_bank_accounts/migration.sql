/*
  Warnings:

  - You are about to drop the column `accountType` on the `bank_accounts` table. All the data in the column will be lost.
  - You are about to drop the column `currency` on the `bank_accounts` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "bank_accounts" DROP COLUMN "accountType",
DROP COLUMN "currency",
ADD COLUMN     "currencyUuid" TEXT;

-- CreateTable
CREATE TABLE "currencies" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "symbol" TEXT,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "currencies_uuid_key" ON "currencies"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "currencies_code_key" ON "currencies"("code");

-- CreateIndex
CREATE INDEX "bank_accounts_currencyUuid_idx" ON "bank_accounts"("currencyUuid");

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_currencyUuid_fkey" FOREIGN KEY ("currencyUuid") REFERENCES "currencies"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
