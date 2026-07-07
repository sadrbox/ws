-- Реквизиты для ЭСФ РК: адрес/свид-во НДС продавца, адрес/страна получателя, КБе счёта.
-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "kbe" TEXT;
-- AlterTable
ALTER TABLE "counterparties" ADD COLUMN     "address" TEXT,
ADD COLUMN     "countryCode" TEXT DEFAULT 'KZ';
-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "address" TEXT,
ADD COLUMN     "vatNumber" TEXT,
ADD COLUMN     "vatSeries" TEXT;
