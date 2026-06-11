-- AlterTable: кассовый ордер — тип операции и документ-основание
ALTER TABLE "cash_orders" ADD COLUMN "operationType" TEXT;
ALTER TABLE "cash_orders" ADD COLUMN "basisDocumentType" TEXT;
ALTER TABLE "cash_orders" ADD COLUMN "basisDocumentUuid" TEXT;
ALTER TABLE "cash_orders" ADD COLUMN "basisDocumentLabel" TEXT;
